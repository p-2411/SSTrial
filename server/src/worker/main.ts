/**
 * Worker process entry point:  `npm run dev:worker`  /  `npm run start:worker`
 *
 * Runs separately from the API. Pulls extraction jobs from the Postgres-backed queue, calls the
 * LLM and writes results back. Run more copies of this process to process more jobs in parallel;
 * the queue guarantees each job goes to only one of them at a time.
 */
import { createServer } from 'node:http';
import { createOpenAIExtractor, createOpenAIResponses } from '../extraction/openai-extractor.ts';
import { createPostgresRateLimiter } from '../extraction/rate-limiter.ts';
import { loadWorkerConfig } from '../infra/config.ts';
import { createDb } from '../infra/db.ts';
import { createLogger } from '../infra/logger.ts';
import { createUploadJobs, startQueue } from '../infra/queue.ts';
import { createSupabaseStorage } from '../infra/storage.ts';
import { databaseCheck, queueCheck, runHealthChecks, workerLoopCheck } from '../ops/health.ts';
import { createOpsStore } from '../ops/store.ts';
import { createUploadStore } from '../uploads/store.ts';
import { startExtractionWorker } from './worker.ts';

const config = loadWorkerConfig();
const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' });

const sql = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
const boss = await startQueue({ connectionString: config.DATABASE_URL, role: 'worker', logger });

await startExtractionWorker({
  boss,
  logger,
  ops: createOpsStore(sql),
  concurrency: config.WORKER_CONCURRENCY,
  uploads: createUploadStore(sql, createUploadJobs(boss)),
  storage: createSupabaseStorage({
    url: config.SUPABASE_URL,
    secretKey: config.SUPABASE_SECRET_KEY,
    bucket: config.STORAGE_BUCKET,
  }),
  rateLimiter: createPostgresRateLimiter(sql, { key: 'openai', requestsPerMinute: config.OPENAI_REQUESTS_PER_MINUTE }),
  extractor: createOpenAIExtractor({
    model: config.OPENAI_MODEL,
    createResponse: createOpenAIResponses({ apiKey: config.OPENAI_API_KEY, timeoutMs: config.OPENAI_TIMEOUT_MS }),
  }),
});

// The worker's only HTTP endpoint: GET /api/health, so the host can tell whether it's working.
const health = createServer(async (request, response) => {
  if (request.method !== 'GET' || request.url !== '/api/health') {
    response.writeHead(404).end();
    return;
  }
  const report = await runHealthChecks([databaseCheck(sql), queueCheck(boss), workerLoopCheck(boss)]);
  response.writeHead(report.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify(report));
});
health.listen(config.PORT, config.HOST, () => logger.info({ port: config.PORT }, 'Worker health check listening'));

// Graceful shutdown (deploys, Ctrl-C): stop taking new jobs and give in-flight ones time to finish.
// Anything still running when the timeout hits is aborted, and pg-boss retries it later.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down: finishing in-flight jobs');
    health.close();
    await boss.stop({ graceful: true, timeout: 30_000 });
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
