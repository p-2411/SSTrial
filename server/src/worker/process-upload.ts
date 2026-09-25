import { createHash } from 'node:crypto';
import { isEmptyExtraction, type UploadErrorCode } from '@label-extractor/shared';
import { classifyOpenAIError, ExtractionError } from '../extraction/errors.ts';
import type { LabelExtractor } from '../extraction/extractor.ts';
import { RateLimitWaitTooLong, type RateLimiter } from '../extraction/rate-limiter.ts';
import type { Logger } from '../infra/logger.ts';
import { StorageUnavailableError, type FileStorage } from '../infra/storage.ts';
import type { UploadStore } from '../uploads/store.ts';

/**
 * Processes one extraction job: download the file, ask the LLM, validate, store the result.
 *
 * This function decides *what happened*; it doesn't talk to the queue. It returns an outcome and
 * `worker.ts` translates that into what pg-boss should do next (complete, retry, or give up).
 * Keeping the queue out of here means every retry decision can be unit-tested with plain fakes.
 */

export interface ProcessUploadDeps {
  uploads: Pick<UploadStore, 'startAttempt' | 'complete' | 'scheduleRetry' | 'fail' | 'recordContentHash' | 'findCompletedTwin'>;
  storage: Pick<FileStorage, 'download'>;
  extractor: LabelExtractor;
  /** Shared across all workers, so together they stay under the provider's request rate. */
  rateLimiter: RateLimiter;
  logger: Logger;
}

/** How long every worker holds off after a rate limit that didn't say how long to wait. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 10_000;

export interface ExtractionJob {
  uploadId: string;
  /** 1 for the first attempt, 2 for the first retry, … */
  attempt: number;
  /** True when the queue won't retry again if this attempt fails. */
  isFinalAttempt: boolean;
  /** Aborted by pg-boss if the job exceeds its expiry, or on shutdown. */
  signal?: AbortSignal;
}

export type JobOutcome =
  /** Data extracted and stored. */
  | { status: 'completed' }
  /**
   * Nothing to do: the upload is already finished (duplicate delivery), no longer exists, or another
   * attempt took it over while this one was running.
   */
  | { status: 'skipped'; reason: string }
  /** This attempt failed with a transient error; the queue should retry after back-off. */
  | { status: 'retry'; code: UploadErrorCode }
  /** Permanently failed: the error isn't transient, or this was the final attempt. */
  | { status: 'failed'; code: UploadErrorCode };

export async function processUpload(deps: ProcessUploadDeps, job: ExtractionJob): Promise<JobOutcome> {
  const log = deps.logger.child({ uploadId: job.uploadId, attempt: job.attempt });

  // Claim the upload: queued|processing → processing. If the row is in any other state (already
  // completed/failed, or deleted), this delivery is stale and there's nothing to do.
  const upload = await deps.uploads.startAttempt(job.uploadId);
  if (!upload) {
    log.warn('Upload is not waiting for processing; skipping job');
    return { status: 'skipped', reason: 'Upload is not in a processable state' };
  }
  // Every write below presents this token. If another attempt takes the upload over meanwhile (our
  // job was handed to another worker), our writes are refused and this attempt simply stands down.
  const claim = upload.claimToken!;
  const lostClaim = (): JobOutcome => {
    log.warn('Another attempt took over this upload; discarding this attempt');
    return { status: 'skipped', reason: 'Another attempt took over this upload' };
  };

  try {
    const bytes = await deps.storage.download(upload.storagePath);
    if (!bytes) {
      throw new ExtractionError('FILE_MISSING', false, `No object at ${upload.storagePath}`);
    }

    // The browser's hash is only a claim; record the real one, then reuse the result of an
    // identical file if we already have one — no need to ask the LLM the same question twice.
    const contentSha256 = sha256Hex(bytes);
    if (contentSha256 !== upload.contentSha256) await deps.uploads.recordContentHash(upload.id, contentSha256);
    const twin = await deps.uploads.findCompletedTwin(contentSha256, upload.id);
    if (twin?.result) {
      if (!(await deps.uploads.complete(upload.id, claim, twin.result))) return lostClaim();
      log.info({ reusedFrom: twin.id }, 'Reused the result of an identical upload');
      return { status: 'completed' };
    }

    await deps.rateLimiter.acquire(job.signal);
    const started = performance.now();
    const result = await deps.extractor.extract(
      { bytes, mimeType: upload.mimeType, fileName: upload.fileName },
      { signal: job.signal },
    );
    const durationMs = Math.round(performance.now() - started);

    // A well-formed answer that contains nothing means this isn't a readable label (a photo of a
    // cat, a blank page). Asking again won't change that, so it's a permanent failure.
    if (isEmptyExtraction(result)) {
      throw new ExtractionError('NO_LABEL_DATA', false, 'Every extracted field was empty');
    }

    // Refused if another attempt took over; whatever that attempt stores stands.
    if (!(await deps.uploads.complete(upload.id, claim, result))) return lostClaim();
    log.info({ durationMs }, 'Extraction completed');
    return { status: 'completed' };
  } catch (thrown) {
    const error = toExtractionError(thrown);
    const logContext = { code: error.code, detail: error.detail, err: error.cause ?? error };

    // The provider asked us to slow down: pause every worker, for as long as it asked, not just this job.
    const providerSaidWait = error.retryAfterMs !== undefined || error.code === 'LLM_RATE_LIMITED';
    if (providerSaidWait && !(error instanceof RateLimitWaitTooLong)) {
      const pauseMs = error.retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS;
      await deps.rateLimiter.pauseFor(pauseMs);
      log.warn({ pauseMs }, 'Provider asked us to back off; paused all LLM requests');
    }

    if (error.retryable && !job.isFinalAttempt) {
      if (!(await deps.uploads.scheduleRetry(upload.id, claim, error.code))) return lostClaim();
      log.warn(logContext, 'Attempt failed with a transient error; will retry');
      return { status: 'retry', code: error.code };
    }

    // Attempt counts go to the logs, not the user: the reason is what they can act on.
    if (!(await deps.uploads.fail(upload.id, claim, error.code))) return lostClaim();
    log.error(logContext, 'Extraction failed permanently');
    return { status: 'failed', code: error.code };
  }
}

/** Anything thrown during processing, reduced to an ExtractionError with a retry decision. */
function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  if (error instanceof StorageUnavailableError) {
    return new ExtractionError('INTERNAL_ERROR', true, `Storage read failed: ${error.message}`, { cause: error });
  }
  // OpenAI SDK errors (and, as a fallback, unexpected bugs → retryable INTERNAL_ERROR).
  return classifyOpenAIError(error);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
