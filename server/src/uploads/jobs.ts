import type { PgBoss, QueueOptions } from 'pg-boss';
import { RETRY_POLICY, type RetryPolicy } from '../extraction/retry-policy.ts';
import type { Db } from '../infra/db.ts';
import { asPgBossDb } from '../infra/queue.ts';
import { SIGNED_UPLOAD_URL_TTL_SECONDS } from '../infra/storage.ts';

/**
 * The upload queues: what they're called, how they retry, and the jobs the uploads store creates.
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
 * expired. If the browser confirms the upload first, the job is cancelled; otherwise it confirms a
 * file that arrived, or discards an upload that never did. Every upload therefore reaches a final
 * state without any periodic clean-up.
 */
export const FINALISE_QUEUE = 'upload-finalise';

/** Run finalise jobs a little after the signed URL stops accepting uploads. */
export const FINALISE_DELAY_SECONDS = SIGNED_UPLOAD_URL_TTL_SECONDS + 10 * 60;

export interface ExtractionJobData {
  uploadId: string;
}

export type FinaliseJobData = ExtractionJobData;

/** The retry policy (extraction/retry-policy.ts) as pg-boss queue settings. */
function extractionQueueOptions(policy: RetryPolicy) {
  return {
    retryLimit: policy.maxAttempts - 1,
    retryDelay: policy.firstDelaySeconds,
    retryBackoff: true, // exponential, with jitter
    retryDelayMax: policy.longestDelaySeconds,
    expireInSeconds: policy.attemptTimeoutSeconds,
  } satisfies QueueOptions;
}

/**
 * A worker processing an extraction job refreshes its claim this often (pg-boss sends the
 * heartbeats automatically, every half interval). If the refreshes stop — the worker died, or can't
 * reach the database — pg-boss hands the job to another worker after about this long plus one
 * supervision pass, instead of waiting for the full expiry.
 */
export const EXTRACTION_HEARTBEAT_SECONDS = 30;

/**
 * Creates the upload queues if needed, and applies the current retry policy to an existing
 * extraction queue. `policy` is overridable so integration tests can retry in seconds.
 */
export async function createUploadQueues(boss: PgBoss, policy: RetryPolicy = RETRY_POLICY): Promise<void> {
  const retryPolicy = extractionQueueOptions(policy);
  // The dead-letter queue must exist before a queue that references it.
  if (!(await boss.getQueue(EXTRACTION_DEAD_LETTER_QUEUE))) {
    await boss.createQueue(EXTRACTION_DEAD_LETTER_QUEUE);
  }
  if (await boss.getQueue(EXTRACTION_QUEUE)) {
    await boss.updateQueue(EXTRACTION_QUEUE, retryPolicy);
  } else {
    await boss.createQueue(EXTRACTION_QUEUE, { ...retryPolicy, deadLetter: EXTRACTION_DEAD_LETTER_QUEUE });
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
  /** Cancel these uploads' finalise jobs once they're settled (or deleted), so they never run for nothing. */
  cancelFinalise(uploadIds: readonly string[], tx?: Db): Promise<void>;
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
    async cancelFinalise(uploadIds, tx) {
      // Also cancels a job that is running, so only the browser's path (or a delete) may call this:
      // the finalise job must not cancel itself.
      await boss.cancel(FINALISE_QUEUE, [...uploadIds], inTransaction(tx));
    },
  };
}
