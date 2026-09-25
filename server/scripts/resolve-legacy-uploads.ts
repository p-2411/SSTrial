/**
 * One-off: brings uploads created before finalise jobs existed in line with the current rules.
 *
 *   1. Files rejected for unsupported content used to be kept as `failed` uploads, file and all.
 *      Rejected files are no longer stored, so both the file and the upload are deleted.
 *   2. Uploads left in `uploading` from before finalise jobs existed never got one. Those whose
 *      signed URL has expired are finalised now, exactly as the job would; newer ones get a job.
 *
 * Safe to re-run: every step only touches rows still in the old state.
 *   node --env-file=.env scripts/resolve-legacy-uploads.ts
 */
import { loadApiConfig } from '../src/infra/config.ts';
import { createDb } from '../src/infra/db.ts';
import { createLogger } from '../src/infra/logger.ts';
import { startQueue } from '../src/infra/queue.ts';
import { createSupabaseStorage, SIGNED_UPLOAD_URL_TTL_SECONDS } from '../src/infra/storage.ts';
import { createEventStore } from '../src/logs/store.ts';
import { finaliseUpload } from '../src/uploads/finalise.ts';
import { createUploadJobs, createUploadQueues } from '../src/uploads/jobs.ts';
import { createUploadStore } from '../src/uploads/store.ts';

const config = loadApiConfig();
const logger = createLogger({ name: 'resolve-legacy-uploads', level: 'info', pretty: false });
const sql = createDb(config.DATABASE_URL, { max: 2 });
const boss = await startQueue({ connectionString: config.DATABASE_URL, role: 'api', logger });
await createUploadQueues(boss);
const jobs = createUploadJobs(boss);
const uploads = createUploadStore(sql, jobs);
const storage = createSupabaseStorage({
  url: config.SUPABASE_URL,
  secretKey: config.SUPABASE_SECRET_KEY,
  bucket: config.STORAGE_BUCKET,
});
// It does the finalise job's work, so it logs the same events as the worker would.
const events = createEventStore(sql, { source: 'worker', logger });

try {
  // 1. Rejected files that were kept.
  const rejected = await sql`select id, storage_path from uploads where error_code = 'FILE_CONTENT_MISMATCH'`;
  for (const row of rejected) {
    await storage.remove(row.storage_path);
    await sql`delete from uploads where id = ${row.id} and error_code = 'FILE_CONTENT_MISMATCH'`;
  }
  logger.info({ count: rejected.length }, 'Deleted uploads kept after their file was rejected');

  // 2. Uploads still waiting for a confirmation that will never come.
  const unfinished = await sql`
    select id, created_at < now() - make_interval(secs => ${SIGNED_UPLOAD_URL_TTL_SECONDS}) as expired
    from uploads where status = 'uploading'`;
  for (const row of unfinished) {
    if (!row.expired) {
      await jobs.scheduleFinalise(row.id);
      continue;
    }
    const result = await finaliseUpload({ uploads, storage, events }, row.id, { caller: 'finalise-job' });
    logger.info({ uploadId: row.id, outcome: result.outcome }, 'Finalised an unconfirmed upload');
  }
  logger.info({ count: unfinished.length }, 'Settled uploads left in "uploading"');
} finally {
  await boss.stop({ graceful: false });
  await sql.end();
}
