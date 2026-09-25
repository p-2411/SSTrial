import { uploadErrorMessage, type UploadErrorCode } from '@label-extractor/shared';
import { isRetryableCode } from './retry-policy.ts';

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

  /** See retry-policy.ts. */
  get retryable(): boolean {
    return isRetryableCode(this.code);
  }
}
