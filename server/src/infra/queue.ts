import { PgBoss, type ConstructorOptions, type QueueOptions } from 'pg-boss';
import type { Db } from './db.ts';
import { asPgBossDb } from './db.ts';
import type { Logger } from './logger.ts';
import { SIGNED_UPLOAD_URL_TTL_SECONDS } from './storage.ts';

/**
 * The job queue: pg-boss on the same Postgres database as our data.
 *
 * pg-boss stores jobs in its own `pgboss` schema and hands them to workers with
 * `SELECT … FOR UPDATE SKIP LOCKED`, so any number of worker processes can pull from one queue
 * without double-processing. Because the queue lives in our database, a job can be created in the
 * same transaction as the row update that justifies it — they commit or roll back together.
 */

/** Main queue: one job per upload to extract. */
export const EXTRACTION_QUEUE = 'label-extraction';

/**
 * Where pg-boss moves a job once it has failed for good (retries exhausted, or failed terminally).
 * A small worker listens here as a safety net: if a worker crashed or hung on the final attempt,
 * nothing got the chance to mark the upload failed, so the dead-letter handler does it.
 */
export const EXTRACTION_DEAD_LETTER_QUEUE = 'label-extraction-dead-letter';

/**
 * One job per upload, scheduled when the upload is created, to run once its signed upload URL has
 * expired. By then the browser has either confirmed the upload (the job finds nothing to do) or
 * never will — so the job confirms a file that arrived, or discards an upload that never did.
 * Every upload therefore reaches a final state without any periodic clean-up.
 */
export const FINALISE_QUEUE = 'upload-finalise';

/** Run finalise jobs a little after the signed URL stops accepting uploads. */
export const FINALISE_DELAY_SECONDS = SIGNED_UPLOAD_URL_TTL_SECONDS + 10 * 60;

/** Runs the monitoring rules once a minute (a pg-boss cron schedule: once per minute, cluster-wide). */
export const OPS_MONITOR_QUEUE = 'ops-monitor';

export interface ExtractionJobData {
  uploadId: string;
}

export type FinaliseJobData = ExtractionJobData;

/**
 * Retry policy for extraction jobs. Retryable failures (timeouts, rate limits, 5xx, malformed
 * output) back off exponentially with jitter, so a struggling LLM provider isn't hammered by every
 * worker at once:  attempt 1 → ~15s → 2 → ~30s → 3 → ~60s → 4 → ~120s → 5.
 */
export const EXTRACTION_RETRY_POLICY = {
  retryLimit: 4,
  retryDelay: 15,
  retryBackoff: true,
  retryDelayMax: 300,
  // An attempt still "active" after this long is presumed dead (worker crashed or hung) and is
  // failed/retried by pg-boss. Must exceed the LLM timeout plus download time.
  expireInSeconds: 180,
} satisfies QueueOptions;

/**
 * A worker processing an extraction job refreshes its claim this often (pg-boss sends the
 * heartbeats automatically, every half interval). If the refreshes stop — the worker died, or can't
 * reach the database — pg-boss hands the job to another worker after about this long plus one
 * supervision pass, instead of waiting for the full expiry.
 */
export const EXTRACTION_HEARTBEAT_SECONDS = 30;

/** Total attempts including the first: retries + 1. Shown in the UI ("attempt 2 of 5"). */
export const MAX_EXTRACTION_ATTEMPTS = EXTRACTION_RETRY_POLICY.retryLimit + 1;

export interface StartQueueOptions {
  connectionString: string;
  /** Which process is connecting. Only workers run pg-boss's background maintenance. */
  role: 'api' | 'worker';
  logger: Logger;
  /** Overridable so integration tests can retry in milliseconds rather than minutes. */
  retryPolicy?: QueueOptions;
  /** pg-boss's own connection pool size. Kept small: Supabase's free tier caps connections. */
  poolMax?: number;
  /** Extra pg-boss settings. Integration tests use a separate schema and faster supervision. */
  overrides?: Partial<ConstructorOptions>;
}

export async function startQueue(options: StartQueueOptions): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    application_name: `label-extractor-${options.role}`,
    max: options.poolMax ?? 3,
    // Maintenance (expiring stuck jobs, deleting old ones) and the monitor's cron schedule only need
    // to run somewhere: in the workers. The API is purely a producer.
    supervise: options.role === 'worker',
    schedule: options.role === 'worker',
    ...options.overrides,
  });

  // pg-boss emits errors from its background loops; unhandled, they'd crash the process.
  boss.on('error', (err) => options.logger.error({ err }, 'Queue error'));

  await boss.start();
  await ensureQueues(boss, options.retryPolicy ?? EXTRACTION_RETRY_POLICY);
  return boss;
}

/** Creates the queues if needed and applies the current retry policy to existing ones. */
async function ensureQueues(boss: PgBoss, retryPolicy: QueueOptions): Promise<void> {
  // The dead-letter queue must exist before a queue that references it.
  if (!(await boss.getQueue(EXTRACTION_DEAD_LETTER_QUEUE))) {
    await boss.createQueue(EXTRACTION_DEAD_LETTER_QUEUE);
  }
  if (await boss.getQueue(EXTRACTION_QUEUE)) {
    await boss.updateQueue(EXTRACTION_QUEUE, retryPolicy);
  } else {
    await boss.createQueue(EXTRACTION_QUEUE, { ...retryPolicy, deadLetter: EXTRACTION_DEAD_LETTER_QUEUE });
  }
  if (!(await boss.getQueue(OPS_MONITOR_QUEUE))) {
    // A missed run is simply replaced by the next minute's, so never retry.
    await boss.createQueue(OPS_MONITOR_QUEUE, { retryLimit: 0, expireInSeconds: 50 });
  }
  if (!(await boss.getQueue(FINALISE_QUEUE))) {
    // Finalising only fails if storage or the database is down, so retry patiently.
    await boss.createQueue(FINALISE_QUEUE, { retryLimit: 10, retryDelay: 60, retryBackoff: true, retryDelayMax: 1800 });
  }
}

/**
 * The jobs the uploads store creates. Pass `tx` to create a job inside an open transaction, so it
 * only exists if that transaction commits.
 */
export interface UploadJobs {
  /** Extract the label data for an upload that is now `queued`. */
  enqueueExtraction(uploadId: string, tx?: Db): Promise<void>;
  /** Make sure a new upload reaches a final state even if the browser never confirms it. */
  scheduleFinalise(uploadId: string, tx?: Db): Promise<void>;
  /** Cancel that finalise job once the browser has settled the upload, so it never runs for nothing. */
  cancelFinalise(uploadId: string, tx?: Db): Promise<void>;
}

export function createUploadJobs(boss: PgBoss): UploadJobs {
  const inTransaction = (tx?: Db) => (tx ? { db: asPgBossDb(tx) } : {});
  return {
    async enqueueExtraction(uploadId, tx) {
      // Duplicates are prevented by the caller, not here: jobs are only enqueued alongside a guarded
      // status transition (e.g. `uploading → queued`), which can only succeed once.
      const data: ExtractionJobData = { uploadId };
      // Heartbeats are set per job: pg-boss can't add them to an existing queue.
      await boss.send(EXTRACTION_QUEUE, data, { ...inTransaction(tx), heartbeatSeconds: EXTRACTION_HEARTBEAT_SECONDS });
    },
    async scheduleFinalise(uploadId, tx) {
      const data: FinaliseJobData = { uploadId };
      // The job's ID is the upload's, so it can be found and cancelled without storing a job ID.
      await boss.send(FINALISE_QUEUE, data, { ...inTransaction(tx), id: uploadId, startAfter: FINALISE_DELAY_SECONDS });
    },
    async cancelFinalise(uploadId, tx) {
      // Also cancels a job that is running, so only the browser's path may call this: the
      // finalise job must not cancel itself.
      await boss.cancel(FINALISE_QUEUE, uploadId, inTransaction(tx));
    },
  };
}
