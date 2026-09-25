import type { Job, JobResult, JobWithMetadata, PgBoss } from 'pg-boss';
import { LOG_RETENTION_DAYS } from '@label-extractor/shared';
import type { Logger } from '../infra/logger.ts';
import { logEvents } from '../logs/events.ts';
import type { EventRetention } from '../logs/store.ts';
import type { OpsStore } from '../ops/store.ts';
import { finaliseUpload, type FinaliseDeps } from '../uploads/finalise.ts';
import {
  EXTRACTION_DEAD_LETTER_QUEUE,
  EXTRACTION_QUEUE,
  FINALISE_QUEUE,
  type ExtractionJobData,
  type FinaliseJobData,
} from '../uploads/jobs.ts';
import type { UploadAttempts } from '../uploads/store.ts';
import { processUpload, type JobOutcome, type ProcessUploadDeps } from './process-upload.ts';

/**
 * Connects the job handlers to pg-boss, one queue each. Separate from main.ts so integration tests
 * can run real handlers against a real queue with fake storage and a fake LLM.
 */

export interface ExtractionWorkerDeps extends ProcessUploadDeps {
  boss: PgBoss;
  uploads: UploadAttempts;
  /** Jobs this process handles at once. */
  concurrency: number;
  /** How often idle workers check for new jobs. */
  pollingIntervalSeconds?: number;
}

/** Extraction jobs, plus the dead-letter safety net for the ones that never finished. */
export async function startExtractionWorker(deps: ExtractionWorkerDeps): Promise<void> {
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
    if (failed) {
      logger.error({ uploadId: job.data.uploadId }, 'Marked upload failed from the dead-letter queue');
      await deps.events.record(logEvents.extractionAbandoned(failed, 'PROCESSING_TIMEOUT'));
    }
  });

  logger.info({ concurrency: deps.concurrency }, 'Worker is waiting for jobs');
}

/** Settles uploads the browser never confirmed, once their signed URL can no longer be used. */
export async function startFinaliseWorker(deps: FinaliseDeps & { boss: PgBoss; logger: Logger }): Promise<void> {
  const { boss, logger } = deps;
  await boss.work(FINALISE_QUEUE, { batchSize: 1 }, async ([job]: Job<FinaliseJobData>[]) => {
    if (!job) return;
    const { uploadId } = job.data;
    const result = await finaliseUpload(deps, uploadId, { caller: 'finalise-job' });
    if (result.outcome === 'discarded') {
      logger.info({ uploadId }, 'Discarded an upload whose file never arrived');
    } else if (result.outcome === 'queued') {
      logger.info({ uploadId }, 'Confirmed an upload the browser never confirmed');
    } else if (result.outcome === 'rejected') {
      logger.info({ uploadId }, 'Deleted an unconfirmed upload with an unsupported file type');
    }
  });
}

/**
 * Once a minute: records that a worker is running (the System status page's worker card), and
 * keeps the activity log pruned.
 */
const OPS_MONITOR_QUEUE = 'ops-monitor';

export interface MonitorDeps {
  boss: PgBoss;
  ops: Pick<OpsStore, 'recordWorkerHeartbeat'>;
  events: EventRetention;
  logger: Logger;
}

export async function startMonitor({ boss, ops, events, logger }: MonitorDeps): Promise<void> {
  if (!(await boss.getQueue(OPS_MONITOR_QUEUE))) {
    // A missed run is simply replaced by the next minute's, so never retry.
    await boss.createQueue(OPS_MONITOR_QUEUE, { retryLimit: 0, expireInSeconds: 50 });
  }
  await boss.work(OPS_MONITOR_QUEUE, { batchSize: 1 }, async () => {
    await ops.recordWorkerHeartbeat();
    await pruneActivityLog({ events, logger });
  });
  // Every minute, cluster-wide: pg-boss creates one job per tick however many workers there are.
  await boss.schedule(OPS_MONITOR_QUEUE, '* * * * *');
  await ops.recordWorkerHeartbeat(); // don't wait a minute for the first heartbeat
}

/**
 * Deletes activity-log events past their retention. Every minute, so each run only removes a
 * minute's worth. A failure is logged and left for the next run: it must not stop the monitor.
 */
export async function pruneActivityLog({ events, logger }: Pick<MonitorDeps, 'events' | 'logger'>): Promise<void> {
  try {
    const pruned = await events.pruneOlderThan(LOG_RETENTION_DAYS);
    if (pruned > 0) logger.info({ pruned }, 'Pruned old activity log events');
  } catch (err) {
    logger.warn({ err }, 'Could not prune the activity log; will try again next minute');
  }
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
