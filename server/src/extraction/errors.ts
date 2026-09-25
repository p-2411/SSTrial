import { uploadErrorMessage, type UploadErrorCode } from '@label-extractor/shared';

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

/**
 * Every way extraction can fail, reduced to what the worker needs to know:
 *   - `code`: what went wrong. It's all that gets stored; users see the shared catalogue's message.
 *   - `retryable`: is it worth trying again later? Follows from the code.
 *   - `providerBackoffMs`: the provider told us to slow down, for this long. The worker then pauses
 *     every worker's requests, not just this job.
 *
 * `detail` carries technical context (status codes, validation issues) for logs only; it is never
 * shown to users.
 */
export class ExtractionError extends Error {
  override name = 'ExtractionError';
  readonly code: UploadErrorCode;
  readonly detail: string | undefined;
  readonly providerBackoffMs: number | undefined;

  constructor(code: UploadErrorCode, detail?: string, options?: ErrorOptions & { providerBackoffMs?: number }) {
    super(uploadErrorMessage(code), options);
    this.code = code;
    this.detail = detail;
    this.providerBackoffMs = options?.providerBackoffMs;
  }

  get retryable(): boolean {
    return isRetryableCode(this.code);
  }
}
