/**
 * API process entry point:  `npm run dev:api`  /  `npm run start:api`
 *
 * Handles browser requests only. It never calls the LLM: it records uploads and puts jobs on the
 * queue, and the separate worker process does the slow work.
 */
import { loadApiConfig } from '../infra/config.ts';
import { createDb } from '../infra/db.ts';
import { createLogger } from '../infra/logger.ts';
import { createExtractionQueue, startQueue } from '../infra/queue.ts';
import { createSupabaseStorage } from '../infra/storage.ts';
import { createUploadStore } from '../uploads/store.ts';
import { buildApp } from './app.ts';

const config = loadApiConfig();
const logger = createLogger({ name: 'api', level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' });

const sql = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
const boss = await startQueue({ connectionString: config.DATABASE_URL, role: 'api', logger });

const app = await buildApp({
  logger,
  webDistDir: config.WEB_DIST_DIR,
  uploads: createUploadStore(sql, createExtractionQueue(boss)),
  storage: createSupabaseStorage({
    url: config.SUPABASE_URL,
    secretKey: config.SUPABASE_SECRET_KEY,
    bucket: config.STORAGE_BUCKET,
    publicUrl: config.SUPABASE_PUBLIC_URL,
  }),
});

await app.listen({ host: config.HOST, port: config.PORT });

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
