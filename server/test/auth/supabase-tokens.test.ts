import { describe, expect, it } from 'vitest';
import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { AuthUnavailableError, userIdFromClaims } from '../../src/auth/supabase-tokens.ts';

const claims = (sub: unknown) => ({ data: { claims: { sub } }, error: null });

describe('userIdFromClaims', () => {
  it("returns the user a valid token was issued to", () => {
    expect(userIdFromClaims(claims('user-1'))).toBe('user-1');
  });

  it.each([
    ['a malformed, forged or expired token', new AuthInvalidJwtError('Invalid JWT signature')],
    ['a token the Auth server rejects', new AuthApiError('invalid JWT', 403, 'bad_jwt')],
    ['a session that no longer exists', new AuthApiError('Session not found', 401, 'session_not_found')],
  ])('treats %s as signed out', (_label, error) => {
    expect(userIdFromClaims({ data: null, error })).toBeNull();
  });

  it.each([
    ['the Auth server being unreachable', new AuthRetryableFetchError('fetch failed', 0)],
    ['the Auth server failing', new AuthApiError('Internal error', 500, undefined)],
    ['the Auth server rate-limiting', new AuthApiError('Too many requests', 429, 'over_request_rate_limit')],
  ])("can't tell during %s, rather than signing everyone out", (_label, error) => {
    expect(() => userIdFromClaims({ data: null, error })).toThrow(AuthUnavailableError);
  });
});
