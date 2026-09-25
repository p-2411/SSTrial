import { PgBoss, type QueueOptions } from 'pg-boss';
import type { Db } from './db.ts';
import { asPgBossDb } from './db.ts';
import type { Logger } from './logger.ts';

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

export interface ExtractionJobData {
  uploadId: string;
}

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
}

export async function startQueue(options: StartQueueOptions): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    application_name: `label-extractor-${options.role}`,
    max: options.poolMax ?? 3,
    // Maintenance (expiring stuck jobs, deleting old ones) only needs to run somewhere; the API is
    // purely a producer. We don't use cron scheduling at all.
    supervise: options.role === 'worker',
    schedule: false,
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
}

/** The one operation the API needs from the queue. */
export interface ExtractionQueue {
  /**
   * Enqueues extraction for an upload. Pass `tx` to create the job inside an open transaction, so
   * it only exists if that transaction commits.
   */
  enqueue(uploadId: string, tx?: Db): Promise<void>;
}

export function createExtractionQueue(boss: PgBoss): ExtractionQueue {
  return {
    async enqueue(uploadId, tx) {
      // Duplicates are prevented by the caller, not here: jobs are only enqueued alongside a guarded
      // status transition (e.g. `uploading → queued`), which can only succeed once.
      const data: ExtractionJobData = { uploadId };
      await boss.send(EXTRACTION_QUEUE, data, tx ? { db: asPgBossDb(tx) } : {});
    },
  };
}
