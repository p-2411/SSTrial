/**
 * Worker process entry point:  `npm run dev:worker`  /  `npm run start:worker`
 *
 * Runs separately from the API. Pulls extraction jobs from the Postgres-backed queue, calls the
 * LLM and writes results back. Run more copies of this process to process more jobs in parallel;
 * the queue guarantees each job goes to only one of them at a time.
 */
import { createOpenAIExtractor, createOpenAIResponses } from '../extraction/openai-extractor.ts';
import { loadWorkerConfig } from '../infra/config.ts';
import { createDb } from '../infra/db.ts';
import { createLogger } from '../infra/logger.ts';
import { createExtractionQueue, startQueue } from '../infra/queue.ts';
import { createSupabaseStorage } from '../infra/storage.ts';
import { createUploadStore } from '../uploads/store.ts';
import { startExtractionWorker } from './worker.ts';

const config = loadWorkerConfig();
const logger = createLogger({ name: 'worker', level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' });

const sql = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
const boss = await startQueue({ connectionString: config.DATABASE_URL, role: 'worker', logger });

await startExtractionWorker({
  boss,
  logger,
  concurrency: config.WORKER_CONCURRENCY,
  uploads: createUploadStore(sql, createExtractionQueue(boss)),
  storage: createSupabaseStorage({
    url: config.SUPABASE_URL,
    secretKey: config.SUPABASE_SECRET_KEY,
    bucket: config.STORAGE_BUCKET,
  }),
  extractor: createOpenAIExtractor({
    model: config.OPENAI_MODEL,
    createResponse: createOpenAIResponses({ apiKey: config.OPENAI_API_KEY, timeoutMs: config.OPENAI_TIMEOUT_MS }),
  }),
});

// Graceful shutdown (deploys, Ctrl-C): stop taking new jobs and give in-flight ones time to finish.
// Anything still running when the timeout hits is aborted, and pg-boss retries it later.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down: finishing in-flight jobs');
    await boss.stop({ graceful: true, timeout: 30_000 });
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
