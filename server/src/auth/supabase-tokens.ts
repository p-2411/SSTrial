import { createClient, isAuthApiError } from '@supabase/supabase-js';
import { AuthUnavailableError, type VerifiedToken, type VerifyAccessToken } from './authenticator.ts';

type ClaimsResult = { data: { claims: { sub?: unknown; exp?: unknown } } | null; error: unknown };

/**
 * Verifies Supabase Auth access tokens. `getClaims` checks the signature against the project's
 * published signing keys (fetched once, then cached), so most checks need no network call. A
 * project still on a shared-secret key falls back to asking the Auth server.
 */
export function createSupabaseTokenVerifier(options: { url: string; publishableKey: string }): VerifyAccessToken {
  const client = createClient(options.url, options.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (token) => {
    let result: ClaimsResult;
    try {
      result = await client.auth.getClaims(token);
    } catch {
      // Auth problems (outages included) come back as `error`; what's thrown is a token that
      // couldn't even be decoded. That's an invalid token, not an outage: signed out.
      return null;
    }
    return verifiedFromClaims(result);
  };
}

/** A `getClaims` result: who the token is for, null if it isn't valid, or AuthUnavailableError. */
export function verifiedFromClaims({ data, error }: ClaimsResult): VerifiedToken | null {
  if (error) {
    if (isInvalidToken(error)) return null;
    throw new AuthUnavailableError("Couldn't check the access token.", { cause: error });
  }
  const { sub, exp } = data?.claims ?? {};
  if (typeof sub !== 'string') return null;
  return { userId: sub, expiresAt: typeof exp === 'number' ? new Date(exp * 1000) : null };
}

function isInvalidToken(error: unknown): boolean {
  // Checked here, against the signing keys: malformed, forged or expired.
  if (error instanceof Error && error.name === 'AuthInvalidJwtError') return true;
  // Checked by the Auth server: it says this token or its session isn't valid (a 429 is only "wait").
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}
