import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import { uploadErrorMessage, type UploadErrorCode } from '@label-extractor/shared';

/**
 * Every way extraction can fail, reduced to what the worker needs to know:
 *   - `code`: what went wrong. It's all that gets stored; users see the shared catalogue's message.
 *   - `retryable`: is it worth trying again later? (timeouts, rate limits, 5xx, malformed output)
 *
 * `detail` carries technical context (status codes, validation issues) for logs only; it is never
 * shown to users.
 */
export class ExtractionError extends Error {
  override name = 'ExtractionError';
  readonly code: UploadErrorCode;
  readonly retryable: boolean;
  readonly detail: string | undefined;
  /** How long the provider asked us to wait before trying again (from its Retry-After headers). */
  readonly retryAfterMs: number | undefined;

  constructor(
    code: UploadErrorCode,
    retryable: boolean,
    detail?: string,
    options?: ErrorOptions & { retryAfterMs?: number },
  ) {
    super(uploadErrorMessage(code), options);
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** Longest back-off we'll accept from a provider header, so a bad value can't stall us for hours. */
const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Reads how long the provider wants us to wait: OpenAI's `retry-after-ms`, or the standard
 * `retry-after` in seconds or as an HTTP date.
 */
export function parseRetryAfter(headers: Headers | undefined, now = Date.now()): number | undefined {
  const clamp = (ms: number) => (Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined);
  const milliseconds = headers?.get('retry-after-ms');
  if (milliseconds) return clamp(Number(milliseconds));
  const value = headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return clamp(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : clamp(date - now);
}

/** Maps anything thrown while calling the OpenAI API to an ExtractionError. */
export function classifyOpenAIError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  const cause = { cause: error };

  // Order matters: the timeout and abort errors are subclasses of the connection error / APIError.
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) {
    // An abort means our own deadline fired (job expiry or shutdown) — to the user it's a timeout.
    return new ExtractionError('LLM_TIMEOUT', true, error.message, cause);
  }
  if (error instanceof APIConnectionError) {
    return new ExtractionError('LLM_UNAVAILABLE', true, `Connection failed: ${error.message}`, cause);
  }
  if (error instanceof APIError) {
    const detail = `HTTP ${error.status ?? '?'} ${error.code ?? ''} ${error.message}`.trim();
    const status = error.status ?? 0;
    const retryAfter = { ...cause, retryAfterMs: parseRetryAfter(error.headers) };

    if (status === 429) {
      // OpenAI uses 429 both for "slow down" (transient) and "out of credit" (not transient).
      return error.code === 'insufficient_quota'
        ? new ExtractionError('LLM_QUOTA_EXCEEDED', false, detail, cause)
        : new ExtractionError('LLM_RATE_LIMITED', true, detail, retryAfter);
    }
    if (status === 401 || status === 403 || status === 404) {
      // Bad key, no access, or unknown model: retrying won't help until someone fixes config.
      return new ExtractionError('LLM_MISCONFIGURED', false, detail, cause);
    }
    if (status === 400 || status === 413 || status === 422) {
      // The request itself was refused, most often because the file couldn't be decoded.
      return new ExtractionError('LLM_REJECTED_INPUT', false, detail, cause);
    }
    // 408, 409, 5xx and anything unexpected: assume transient. A 503 may also say when to come back.
    return new ExtractionError('LLM_UNAVAILABLE', true, detail, retryAfter);
  }

  // Not an API error at all — most likely a bug. Retrying is safe and sometimes helps.
  const detail = error instanceof Error ? error.message : String(error);
  return new ExtractionError('INTERNAL_ERROR', true, detail, cause);
}
