import { isEmptyExtraction, type UploadErrorCode } from '@label-extractor/shared';
import { classifyOpenAIError, ExtractionError } from '../extraction/errors.ts';
import type { LabelExtractor } from '../extraction/extractor.ts';
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
  uploads: Pick<UploadStore, 'startAttempt' | 'complete' | 'scheduleRetry' | 'fail'>;
  storage: Pick<FileStorage, 'download'>;
  extractor: LabelExtractor;
  logger: Logger;
}

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
  /** Nothing to do: the upload is already finished (duplicate delivery) or no longer exists. */
  | { status: 'skipped'; reason: string }
  /** This attempt failed with a transient error; the queue should retry after back-off. */
  | { status: 'retry'; code: UploadErrorCode; message: string }
  /** Permanently failed: the error isn't transient, or this was the final attempt. */
  | { status: 'failed'; code: UploadErrorCode; message: string };

export async function processUpload(deps: ProcessUploadDeps, job: ExtractionJob): Promise<JobOutcome> {
  const log = deps.logger.child({ uploadId: job.uploadId, attempt: job.attempt });

  // Claim the upload: queued|processing → processing. If the row is in any other state (already
  // completed/failed, or deleted), this delivery is stale and there's nothing to do.
  const upload = await deps.uploads.startAttempt(job.uploadId);
  if (!upload) {
    log.warn('Upload is not waiting for processing; skipping job');
    return { status: 'skipped', reason: 'Upload is not in a processable state' };
  }

  try {
    const bytes = await deps.storage.download(upload.storagePath);
    if (!bytes) {
      throw new ExtractionError('FILE_MISSING', 'The uploaded file could not be found.', false);
    }

    const started = performance.now();
    const result = await deps.extractor.extract(
      { bytes, mimeType: upload.mimeType, fileName: upload.fileName },
      { signal: job.signal },
    );
    const durationMs = Math.round(performance.now() - started);

    // A well-formed answer that contains nothing means this isn't a readable label (a photo of a
    // cat, a blank page). Asking again won't change that, so it's a permanent failure.
    if (isEmptyExtraction(result)) {
      throw new ExtractionError(
        'NO_LABEL_DATA',
        "Couldn't find any product label information in this file.",
        false,
      );
    }

    if (!(await deps.uploads.complete(upload.id, result))) {
      // Another delivery of the same job finished first. Harmless; theirs is stored.
      return { status: 'skipped', reason: 'Upload was completed by another attempt' };
    }
    log.info({ durationMs }, 'Extraction completed');
    return { status: 'completed' };
  } catch (thrown) {
    const error = toExtractionError(thrown);
    const logContext = { code: error.code, detail: error.detail, err: error.cause ?? error };

    if (error.retryable && !job.isFinalAttempt) {
      await deps.uploads.scheduleRetry(upload.id, { code: error.code, message: error.message });
      log.warn(logContext, 'Attempt failed with a transient error; will retry');
      return { status: 'retry', code: error.code, message: error.message };
    }

    // Attempt counts go to the logs, not the user: the reason is what they can act on.
    await deps.uploads.fail(upload.id, { code: error.code, message: error.message });
    log.error(logContext, 'Extraction failed permanently');
    return { status: 'failed', code: error.code, message: error.message };
  }
}

/** Anything thrown during processing, reduced to an ExtractionError with a retry decision. */
function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  if (error instanceof StorageUnavailableError) {
    return new ExtractionError('INTERNAL_ERROR', "Couldn't read the uploaded file from storage.", true, error.message, {
      cause: error,
    });
  }
  // OpenAI SDK errors (and, as a fallback, unexpected bugs → retryable INTERNAL_ERROR).
  return classifyOpenAIError(error);
}
