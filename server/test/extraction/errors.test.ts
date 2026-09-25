import { describe, expect, it } from 'vitest';
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import { classifyOpenAIError, ExtractionError } from '../../src/extraction/errors.ts';

/** Builds the same error subclass the SDK throws for an HTTP error response with this body. */
function httpError(status: number, code?: string) {
  return APIError.generate(status, { error: { code, message: `HTTP ${status}` } }, undefined, new Headers());
}

describe('classifyOpenAIError', () => {
  it.each([
    ['a request timeout', new APIConnectionTimeoutError(), 'LLM_TIMEOUT'],
    ['our own abort (job deadline)', new APIUserAbortError(), 'LLM_TIMEOUT'],
    ['a network failure', new APIConnectionError({ message: 'ECONNRESET' }), 'LLM_UNAVAILABLE'],
    ['a rate limit (429)', httpError(429, 'rate_limit_exceeded'), 'LLM_RATE_LIMITED'],
    ['a server error (500)', httpError(500), 'LLM_UNAVAILABLE'],
    ['an overloaded service (503)', httpError(503), 'LLM_UNAVAILABLE'],
    ['a request timeout status (408)', httpError(408), 'LLM_UNAVAILABLE'],
    ['an unknown bug', new TypeError('Cannot read properties of undefined'), 'INTERNAL_ERROR'],
  ])('retries %s', (_label, error, code) => {
    expect(classifyOpenAIError(error)).toMatchObject({ code, retryable: true });
  });

  it.each([
    ['exhausted credit (429 insufficient_quota)', httpError(429, 'insufficient_quota'), 'LLM_QUOTA_EXCEEDED'],
    ['a bad API key (401)', httpError(401), 'LLM_MISCONFIGURED'],
    ['no access to the model (403)', httpError(403), 'LLM_MISCONFIGURED'],
    ['an unknown model (404)', httpError(404), 'LLM_MISCONFIGURED'],
    ['an unreadable file (400)', httpError(400), 'LLM_REJECTED_INPUT'],
  ])('does not retry %s', (_label, error, code) => {
    expect(classifyOpenAIError(error)).toMatchObject({ code, retryable: false });
  });

  it('passes ExtractionErrors through unchanged', () => {
    const original = new ExtractionError('LLM_REFUSED', false);
    expect(classifyOpenAIError(original)).toBe(original);
  });

  it('keeps the original error as the cause, for logs', () => {
    const original = httpError(500);
    expect(classifyOpenAIError(original).cause).toBe(original);
  });
});
