import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import type { UploadErrorCode } from '@label-extractor/shared';

/**
 * Every way extraction can fail, reduced to the two things the worker needs to know:
 *   - `retryable`: is it worth trying again later? (timeouts, rate limits, 5xx, malformed output)
 *   - `message`: what to tell the user if we give up.
 *
 * `detail` carries technical context (status codes, validation issues) for logs only; it is never
 * shown to users.
 */
export class ExtractionError extends Error {
  override name = 'ExtractionError';
  readonly code: UploadErrorCode;
  readonly retryable: boolean;
  readonly detail: string | undefined;

  constructor(code: UploadErrorCode, message: string, retryable: boolean, detail?: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}

/** Maps anything thrown while calling the OpenAI API to an ExtractionError. */
export function classifyOpenAIError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  const cause = { cause: error };

  // Order matters: the timeout and abort errors are subclasses of the connection error / APIError.
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) {
    // An abort means our own deadline fired (job expiry or shutdown) — to the user it's a timeout.
    return new ExtractionError('LLM_TIMEOUT', 'The AI service took too long to respond.', true, error.message, cause);
  }
  if (error instanceof APIConnectionError) {
    return new ExtractionError('LLM_UNAVAILABLE', "Couldn't reach the AI service.", true, error.message, cause);
  }
  if (error instanceof APIError) {
    const detail = `HTTP ${error.status ?? '?'} ${error.code ?? ''} ${error.message}`.trim();
    const status = error.status ?? 0;

    if (status === 429) {
      // OpenAI uses 429 both for "slow down" (transient) and "out of credit" (not transient).
      return error.code === 'insufficient_quota'
        ? new ExtractionError('LLM_QUOTA_EXCEEDED', 'The AI service account has run out of credit.', false, detail, cause)
        : new ExtractionError('LLM_RATE_LIMITED', 'The AI service is rate-limiting requests.', true, detail, cause);
    }
    if (status === 401 || status === 403 || status === 404) {
      // Bad key, no access, or unknown model: retrying won't help until someone fixes config.
      return new ExtractionError(
        'LLM_MISCONFIGURED',
        'The AI service rejected our request because of a configuration problem.',
        false,
        detail,
        cause,
      );
    }
    if (status === 400 || status === 413 || status === 422) {
      // The request itself was refused, most often because the file couldn't be decoded.
      return new ExtractionError('LLM_REJECTED_INPUT', "The AI service couldn't read this file.", false, detail, cause);
    }
    // 408, 409, 5xx and anything unexpected: assume transient.
    return new ExtractionError('LLM_UNAVAILABLE', 'The AI service is temporarily unavailable.', true, detail, cause);
  }

  // Not an API error at all — most likely a bug. Retrying is safe and sometimes helps.
  const detail = error instanceof Error ? error.message : String(error);
  return new ExtractionError('INTERNAL_ERROR', 'Something went wrong while processing this file.', true, detail, cause);
}
