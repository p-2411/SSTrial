import { describe, expect, it } from 'vitest';
import type { UploadErrorCode } from '@label-extractor/shared';
import { decideAfterFailure } from '../../src/extraction/retry-policy.ts';

describe('decideAfterFailure', () => {
  it.each<[UploadErrorCode, boolean, 'retry' | 'fail']>([
    ['LLM_TIMEOUT', false, 'retry'],
    ['LLM_RATE_LIMITED', false, 'retry'],
    ['LLM_UNAVAILABLE', false, 'retry'],
    ['LLM_INVALID_RESPONSE', false, 'retry'],
    ['INTERNAL_ERROR', false, 'retry'],
    ['LLM_TIMEOUT', true, 'fail'], // attempts used up
    ['LLM_REFUSED', false, 'fail'],
    ['LLM_REJECTED_INPUT', false, 'fail'],
    ['LLM_MISCONFIGURED', false, 'fail'],
    ['LLM_QUOTA_EXCEEDED', false, 'fail'],
    ['NO_LABEL_DATA', false, 'fail'],
    ['FILE_MISSING', false, 'fail'],
  ])('%s (final attempt: %s) → %s', (code, isFinalAttempt, next) => {
    expect(decideAfterFailure({ code }, isFinalAttempt).next).toBe(next);
  });

  it('pauses every worker when the provider asks, even after the final attempt', () => {
    expect(decideAfterFailure({ code: 'LLM_RATE_LIMITED', providerBackoffMs: 7000 }, false)).toEqual({ next: 'retry', pauseAllMs: 7000 });
    expect(decideAfterFailure({ code: 'LLM_RATE_LIMITED', providerBackoffMs: 7000 }, true)).toEqual({ next: 'fail', pauseAllMs: 7000 });
  });

  it("doesn't pause anyone when the provider didn't ask", () => {
    expect(decideAfterFailure({ code: 'LLM_TIMEOUT' }, false).pauseAllMs).toBeUndefined();
  });
});
