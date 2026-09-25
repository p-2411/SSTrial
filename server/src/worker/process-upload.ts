import { createHash } from 'node:crypto';
import { isEmptyExtraction, type LabelExtraction, type UploadErrorCode } from '@label-extractor/shared';
import { ExtractionError } from '../extraction/errors.ts';
import { decideAfterFailure } from '../extraction/retry-policy.ts';
import type { LabelExtractor } from '../extraction/extractor.ts';
import type { RateLimiter } from '../extraction/rate-limiter.ts';
import type { Logger } from '../infra/logger.ts';
import { StorageUnavailableError, type FileStorage } from '../infra/storage.ts';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import type { UploadAttempts, UploadRecord } from '../uploads/store.ts';

/**
 * Processes one extraction job: download the file, ask the LLM, validate, store the result.
 *
 * This function decides *what happened*; it doesn't talk to the queue. It returns an outcome and
 * `worker.ts` translates that into what pg-boss should do next (complete, retry, or give up).
 * Keeping the queue out of here means every retry decision can be unit-tested with plain fakes.
 */

export interface ProcessUploadDeps {
  uploads: Omit<UploadAttempts, 'failAbandoned'>;
  storage: Pick<FileStorage, 'download'>;
  extractor: LabelExtractor;
  /** Shared across all workers, so together they stay under the provider's request rate. */
  rateLimiter: RateLimiter;
  logger: Logger;
  /** The activity log: each attempt's start and outcome. */
  events: EventLog;
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
  const attempt: Attempt = { upload, claim: upload.claimToken!, log };
  await deps.events.record(logEvents.extractionStarted(upload));

  try {
    const { result, ...details } = await extractOrReuse(deps, upload, job.signal);
    const completed = await deps.uploads.complete(upload.id, attempt.claim, result);
    if (!completed) return lostClaim(log);
    log.info(details, 'Extraction completed');
    await deps.events.record(logEvents.extractionCompleted(completed, { productName: result.productName, ...details }));
    return { status: 'completed' };
  } catch (thrown) {
    return recordFailure(deps, attempt, toExtractionError(thrown), job.isFinalAttempt);
  }
}

interface Attempt {
  upload: UploadRecord;
  claim: string;
  log: Logger;
}

/**
 * The label data for this upload: an identical file's result if we already have one — no need to
 * ask the LLM the same question twice — otherwise a fresh, non-empty extraction.
 */
async function extractOrReuse(
  deps: ProcessUploadDeps,
  upload: UploadRecord,
  signal: AbortSignal | undefined,
): Promise<{ result: LabelExtraction; reusedFrom?: string; durationMs?: number }> {
  const bytes = await deps.storage.download(upload.storagePath);
  if (!bytes) throw new ExtractionError('FILE_MISSING', `No object at ${upload.storagePath}`);

  // The browser's hash is only a claim; record the real one before looking for a twin.
  const contentSha256 = sha256Hex(bytes);
  if (contentSha256 !== upload.contentSha256) await deps.uploads.recordContentHash(upload.id, contentSha256);
  const twin = await deps.uploads.findCompletedTwin(contentSha256, upload.id);
  if (twin?.result) return { result: twin.result, reusedFrom: twin.id };

  await deps.rateLimiter.acquire(signal);
  const started = performance.now();
  const result = await deps.extractor.extract({ bytes, mimeType: upload.mimeType, fileName: upload.fileName }, { signal });

  // A well-formed answer that contains nothing means this isn't a readable label (a photo of a
  // cat, a blank page). Asking again won't change that, so it's a permanent failure.
  if (isEmptyExtraction(result)) throw new ExtractionError('NO_LABEL_DATA', 'Every extracted field was empty');
  return { result, durationMs: Math.round(performance.now() - started) };
}

/** Carries out what the retry policy decides for a failed attempt (see decideAfterFailure). */
async function recordFailure(
  deps: ProcessUploadDeps,
  { upload, claim, log }: Attempt,
  error: ExtractionError,
  isFinalAttempt: boolean,
): Promise<JobOutcome> {
  const logContext = { code: error.code, detail: error.detail, err: error.cause ?? error };
  const decision = decideAfterFailure(error, isFinalAttempt);

  if (decision.pauseAllMs !== undefined) {
    await deps.rateLimiter.pauseFor(decision.pauseAllMs);
    log.warn({ pauseMs: decision.pauseAllMs }, 'Provider asked us to back off; paused all LLM requests');
    await deps.events.record(logEvents.rateLimitPaused(upload, decision.pauseAllMs));
  }

  if (decision.next === 'retry') {
    const queued = await deps.uploads.scheduleRetry(upload.id, claim, error.code);
    if (!queued) return lostClaim(log);
    log.warn(logContext, 'Attempt failed with a transient error; will retry');
    await deps.events.record(logEvents.retryScheduled(queued, error.code));
    return { status: 'retry', code: error.code };
  }

  // Attempt counts go to the logs, not the user: the reason is what they can act on.
  const failed = await deps.uploads.fail(upload.id, claim, error.code);
  if (!failed) return lostClaim(log);
  log.error(logContext, 'Extraction failed permanently');
  await deps.events.record(logEvents.extractionFailed(failed, error.code));
  return { status: 'failed', code: error.code };
}

/** A claim-guarded write was refused: another attempt took over, and whatever it stores stands. */
function lostClaim(log: Logger): JobOutcome {
  log.warn('Another attempt took over this upload; discarding this attempt');
  return { status: 'skipped', reason: 'Another attempt took over this upload' };
}

/**
 * Anything thrown during processing, as an ExtractionError. Extractors already throw these; what's
 * left is our own infrastructure failing, or a bug — both worth another try.
 */
function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  const detail = error instanceof StorageUnavailableError ? `Storage read failed: ${error.message}` : String(error);
  return new ExtractionError('INTERNAL_ERROR', detail, { cause: error });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
