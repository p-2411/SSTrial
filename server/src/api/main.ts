/**
 * API process entry point:  `npm run dev:api`  /  `npm run start:api`
 *
 * Handles browser requests only. It never calls the LLM: it records uploads and puts jobs on the
 * queue, and the separate worker process does the slow work.
 */
import { createAuthenticator } from '../auth/authenticator.ts';
import { createMemberStore } from '../auth/members.ts';
import { createSupabaseTokenVerifier } from '../auth/supabase-tokens.ts';
import { loadApiConfig } from '../infra/config.ts';
import { listenForChanges } from '../infra/change-feed.ts';
import { createDb } from '../infra/db.ts';
import { createLogger } from '../infra/logger.ts';
import { startQueue } from '../infra/queue.ts';
import { createSupabaseStorage, syncBucketSettings } from '../infra/storage.ts';
import { logEvents } from '../logs/events.ts';
import { createEventStore } from '../logs/store.ts';
import { databaseCheck, queueCheck, runHealthChecks } from '../ops/health.ts';
import { createOpsStore } from '../ops/store.ts';
import { createUploadJobs, createUploadQueues } from '../uploads/jobs.ts';
import { createUploadStore } from '../uploads/store.ts';
import { buildApp } from './app.ts';

const config = loadApiConfig();
const logger = createLogger({ name: 'api', level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' });

const sql = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });

// The bucket's size and type limits come from the shared upload rules, applied here on every start.
await syncBucketSettings({ url: config.SUPABASE_URL, secretKey: config.SUPABASE_SECRET_KEY, bucket: config.STORAGE_BUCKET });
const boss = await startQueue({ connectionString: config.DATABASE_URL, role: 'api', logger });
await createUploadQueues(boss);
const events = createEventStore(sql, { source: 'api', logger });
const members = createMemberStore(sql);
const authenticator = createAuthenticator({
  verifyAccessToken: createSupabaseTokenVerifier({ url: config.SUPABASE_URL, publishableKey: config.SUPABASE_PUBLISHABLE_KEY }),
  members,
});

const app = await buildApp({
  logger,
  authenticator,
  // Browsers reach Supabase at the public URL where it differs (Docker); see config.ts.
  publicConfig: { supabaseUrl: config.SUPABASE_PUBLIC_URL ?? config.SUPABASE_URL, supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY },
  events,
  changes: await listenForChanges(sql, logger),
  health: () => runHealthChecks([databaseCheck(sql), queueCheck(boss)]),
  ops: createOpsStore(sql),
  webDistDir: config.WEB_DIST_DIR,
  uploads: createUploadStore(sql, createUploadJobs(boss)),
  storage: createSupabaseStorage({
    url: config.SUPABASE_URL,
    secretKey: config.SUPABASE_SECRET_KEY,
    bucket: config.STORAGE_BUCKET,
    publicUrl: config.SUPABASE_PUBLIC_URL,
  }),
});

await app.listen({ host: config.HOST, port: config.PORT });
// Deploys and restarts show up in the activity log, next to whatever they affected.
await events.record(logEvents.processStarted('API'));

// Graceful shutdown: stop accepting connections, let in-flight requests finish, then disconnect.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, 'Shutting down');
    await app.close();
    await boss.stop({ graceful: true, timeout: 10_000 });
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
