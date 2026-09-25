import type { UploadErrorCode } from '@label-extractor/shared';

/**
 * When a failed extraction is tried again, and when it isn't. Rules only: uploads/jobs.ts turns
 * RETRY_POLICY into queue settings, and the worker carries out each decideAfterFailure.
 */

export interface RetryPolicy {
  /** Attempts in all, including the first. Shown to users ("attempt 2 of 5"). */
  maxAttempts: number;
  /** The wait before the first retry. Each later wait roughly doubles, with some randomness. */
  firstDelaySeconds: number;
  /** No wait is longer than this. */
  longestDelaySeconds: number;
  /** An attempt still running after this long is presumed dead, and its job is handed on. */
  attemptTimeoutSeconds: number;
}

/**
 * Five attempts, about 15 s, 30 s, 60 s and 120 s apart, so a struggling AI service isn't hammered.
 * The timeout must exceed the AI call's own (90 s) plus the file download.
 */
export const RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  firstDelaySeconds: 15,
  longestDelaySeconds: 300,
  attemptTimeoutSeconds: 180,
};

/** Failures worth another attempt later: the cause is likely to have passed by then. */
const RETRYABLE_CODES: ReadonlySet<UploadErrorCode> = new Set<UploadErrorCode>([
  'LLM_TIMEOUT',
  'LLM_RATE_LIMITED',
  'LLM_UNAVAILABLE',
  'LLM_INVALID_RESPONSE', // output varies from run to run
  'INTERNAL_ERROR', // most likely a passing hiccup (storage, network); a real bug fails on the last attempt
]);

/** Whether a failure with this code is worth another attempt (see RETRYABLE_CODES). */
export function isRetryableCode(code: UploadErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

export interface AfterFailure {
  /** Try again later, or stop for good. */
  next: 'retry' | 'fail';
  /** The provider told every caller to slow down: hold all workers' requests for this long. */
  pauseAllMs: number | undefined;
}

/** What happens after a failed attempt: retry if it could help and attempts remain, else stop. */
export function decideAfterFailure(
  failure: { code: UploadErrorCode; providerBackoffMs?: number | undefined },
  isFinalAttempt: boolean,
): AfterFailure {
  return {
    next: isRetryableCode(failure.code) && !isFinalAttempt ? 'retry' : 'fail',
    // Even after a final attempt: the other workers still need to slow down.
    pauseAllMs: failure.providerBackoffMs,
  };
}
