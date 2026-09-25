import type { Job, JobResult, JobWithMetadata, PgBoss } from 'pg-boss';
import type { Logger } from '../infra/logger.ts';
import {
  EXTRACTION_DEAD_LETTER_QUEUE,
  EXTRACTION_QUEUE,
  FINALISE_QUEUE,
  OPS_MONITOR_QUEUE,
  type ExtractionJobData,
  type FinaliseJobData,
} from '../infra/queue.ts';
import type { FileStorage } from '../infra/storage.ts';
import { runMonitor } from '../ops/monitor.ts';
import type { OpsStore } from '../ops/store.ts';
import { finaliseUpload } from '../uploads/finalise.ts';
import type { UploadStore } from '../uploads/store.ts';
import { processUpload, type JobOutcome, type ProcessUploadDeps } from './process-upload.ts';

/**
 * Connects the job handlers to pg-boss. Separate from main.ts so integration tests can run a real
 * worker against a real queue with fake storage and a fake LLM.
 */

export interface WorkerDeps extends ProcessUploadDeps {
  boss: PgBoss;
  uploads: ProcessUploadDeps['uploads'] & Pick<UploadStore, 'failAbandoned' | 'findById' | 'markUploaded' | 'discardUnfinished'>;
  storage: ProcessUploadDeps['storage'] & Pick<FileStorage, 'readHead' | 'remove'>;
  /** Jobs this process handles at once. */
  concurrency: number;
  /** How often idle workers check for new jobs. */
  pollingIntervalSeconds?: number;
  /** When given, this worker also runs the once-a-minute monitor (see ops/monitor.ts). */
  ops?: OpsStore;
}

export async function startExtractionWorker(deps: WorkerDeps): Promise<void> {
  const { boss, logger } = deps;

  // No explicit type arguments here: pg-boss infers the handler's shape from the literal options
  // (includeMetadata + perJobResults), which an explicit <T> would switch off.
  await boss.work(
    EXTRACTION_QUEUE,
    {
      batchSize: 1,
      localConcurrency: deps.concurrency,
      includeMetadata: true, // gives us retryCount/retryLimit
      perJobResults: true, // lets the handler choose completed / failed (retry) / deadletter (stop)
      pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2,
    },
    async ([job]: JobWithMetadata<ExtractionJobData>[]): Promise<JobResult[]> => {
      if (!job) return [];
      const outcome = await processUpload(deps, {
        uploadId: job.data.uploadId,
        attempt: job.retryCount + 1,
        isFinalAttempt: job.retryCount >= job.retryLimit,
        signal: job.signal,
      });
      return [{ id: job.id, status: toJobStatus(outcome), output: outcome }];
    },
  );

  // Safety net. Jobs land here when pg-boss gives up on them. Normally processUpload has already
  // marked the upload failed, and this is a no-op. But if a worker crashed or hung on the final
  // attempt (the job expired), nobody did — without this the upload would sit in "processing"
  // forever.
  await boss.work(EXTRACTION_DEAD_LETTER_QUEUE, { batchSize: 1 }, async ([job]: Job<ExtractionJobData>[]) => {
    if (!job) return;
    const failed = await deps.uploads.failAbandoned(job.data.uploadId, 'PROCESSING_TIMEOUT');
    if (failed) logger.error({ uploadId: job.data.uploadId }, 'Marked upload failed from the dead-letter queue');
  });

  // Settles uploads the browser never confirmed, once their signed URL can no longer be used.
  await boss.work(FINALISE_QUEUE, { batchSize: 1 }, async ([job]: Job<FinaliseJobData>[]) => {
    if (!job) return;
    const { uploadId } = job.data;
    const result = await finaliseUpload(deps, uploadId, { caller: 'finalise-job' });
    if (result.outcome === 'not-uploaded') {
      // The URL has expired, so this file can never arrive: the upload is simply dropped.
      await deps.uploads.discardUnfinished(uploadId);
      logger.info({ uploadId }, 'Discarded an upload whose file never arrived');
    } else if (result.outcome === 'queued') {
      logger.info({ uploadId }, 'Confirmed an upload the browser never confirmed');
    } else if (result.outcome === 'rejected') {
      logger.info({ uploadId }, 'Deleted an unconfirmed upload with an unsupported file type');
    }
  });

  if (deps.ops) {
    const ops = deps.ops;
    await boss.work(OPS_MONITOR_QUEUE, { batchSize: 1 }, async () => {
      await runMonitor({ ops, logger });
    });
    // Every minute, cluster-wide: pg-boss creates one job per tick however many workers there are.
    await boss.schedule(OPS_MONITOR_QUEUE, '* * * * *');
    await runMonitor({ ops, logger }); // don't wait a minute for the first heartbeat
  }

  logger.info({ concurrency: deps.concurrency }, 'Worker is waiting for jobs');
}

/** How each outcome maps onto pg-boss's per-job result. */
function toJobStatus(outcome: JobOutcome): JobResult['status'] {
  switch (outcome.status) {
    case 'completed':
    case 'skipped':
      return 'completed';
    case 'retry':
      return 'failed'; // pg-boss retries failed jobs until retryLimit, with back-off
    case 'failed':
      return 'deadletter'; // terminal: skip any remaining retries, move to the dead-letter queue
  }
}
