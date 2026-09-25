import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import { ExtractionError } from './errors.ts';

/** Longest back-off we'll accept from a provider header, so a bad value can't stall us for hours. */
const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;
/** How long every worker holds off after a rate limit that didn't say how long to wait. */
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 10_000;

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
    return new ExtractionError('LLM_TIMEOUT', error.message, cause);
  }
  if (error instanceof APIConnectionError) {
    return new ExtractionError('LLM_UNAVAILABLE', `Connection failed: ${error.message}`, cause);
  }
  if (error instanceof APIError) {
    const detail = `HTTP ${error.status ?? '?'} ${error.code ?? ''} ${error.message}`.trim();
    const status = error.status ?? 0;
    const retryAfterMs = parseRetryAfter(error.headers);

    if (status === 429) {
      // OpenAI uses 429 both for "slow down" (transient) and "out of credit" (not transient).
      return error.code === 'insufficient_quota'
        ? new ExtractionError('LLM_QUOTA_EXCEEDED', detail, cause)
        : new ExtractionError('LLM_RATE_LIMITED', detail, {
            ...cause,
            providerBackoffMs: retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS,
          });
    }
    if (status === 401 || status === 403 || status === 404) {
      // Bad key, no access, or unknown model: retrying won't help until someone fixes config.
      return new ExtractionError('LLM_MISCONFIGURED', detail, cause);
    }
    if (status === 400 || status === 413 || status === 422) {
      // The request itself was refused, most often because the file couldn't be decoded.
      return new ExtractionError('LLM_REJECTED_INPUT', detail, cause);
    }
    // 408, 409, 5xx and anything unexpected: assume transient. A 503 may also say when to come back.
    return new ExtractionError('LLM_UNAVAILABLE', detail, { ...cause, providerBackoffMs: retryAfterMs });
  }

  // Not an API error at all — most likely a bug. Retrying is safe and sometimes helps.
  const detail = error instanceof Error ? error.message : String(error);
  return new ExtractionError('INTERNAL_ERROR', detail, cause);
}
