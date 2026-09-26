import { describe, expect, it } from 'vitest';
import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { AuthUnavailableError } from '../../src/auth/authenticator.ts';
import { createSupabaseTokenVerifier, verifiedFromClaims } from '../../src/auth/supabase-tokens.ts';

const claims = (sub: unknown, exp?: number) => ({ data: { claims: { sub, exp } }, error: null });

describe('verifiedFromClaims', () => {
  it('returns the user a valid token was issued to, and when it runs out', () => {
    expect(verifiedFromClaims(claims('user-1', 1_790_000_000))).toEqual({ userId: 'user-1', expiresAt: new Date(1_790_000_000_000) });
    expect(verifiedFromClaims(claims('user-1'))).toEqual({ userId: 'user-1', expiresAt: null });
  });

  it.each([
    ['a malformed, forged or expired token', new AuthInvalidJwtError('Invalid JWT signature')],
    ['a token the Auth server rejects', new AuthApiError('invalid JWT', 403, 'bad_jwt')],
    ['a session that no longer exists', new AuthApiError('Session not found', 401, 'session_not_found')],
  ])('treats %s as signed out', (_label, error) => {
    expect(verifiedFromClaims({ data: null, error })).toBeNull();
  });

  it.each([
    ['the Auth server being unreachable', new AuthRetryableFetchError('fetch failed', 0)],
    ['the Auth server failing', new AuthApiError('Internal error', 500, undefined)],
    ['the Auth server rate-limiting', new AuthApiError('Too many requests', 429, 'over_request_rate_limit')],
  ])("can't tell during %s, rather than signing everyone out", (_label, error) => {
    expect(() => verifiedFromClaims({ data: null, error })).toThrow(AuthUnavailableError);
  });
});

describe('createSupabaseTokenVerifier', () => {
  it("treats a token that can't even be decoded as signed out, not as Auth being down", async () => {
    const verify = createSupabaseTokenVerifier({ url: 'http://127.0.0.1:9', publishableKey: 'test' });
    await expect(verify('YQ.YQ.YQ')).resolves.toBeNull();
    await expect(verify('not-a-jwt')).resolves.toBeNull();
  });
});
