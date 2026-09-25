import { createClient, isAuthApiError } from '@supabase/supabase-js';
import type { VerifyAccessToken } from './authenticator.ts';

/**
 * A token couldn't be checked right now: Supabase Auth is unreachable, failing or rate-limiting.
 * Not the same as an invalid token: answering "signed out" here would sign every user out during
 * an Auth outage, so the API answers 503 instead and people stay signed in.
 */
export class AuthUnavailableError extends Error {
  override name = 'AuthUnavailableError';
}

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
    let result: { data: { claims: { sub?: unknown } } | null; error: unknown };
    try {
      result = await client.auth.getClaims(token);
    } catch (error) {
      throw new AuthUnavailableError("Couldn't check the access token.", { cause: error });
    }
    return userIdFromClaims(result);
  };
}

/** A `getClaims` result as the user ID, null for a token that isn't valid, or AuthUnavailableError. */
export function userIdFromClaims({ data, error }: { data: { claims: { sub?: unknown } } | null; error: unknown }): string | null {
  if (error) {
    if (isInvalidToken(error)) return null;
    throw new AuthUnavailableError("Couldn't check the access token.", { cause: error });
  }
  return typeof data?.claims.sub === 'string' ? data.claims.sub : null;
}

function isInvalidToken(error: unknown): boolean {
  // Checked here, against the signing keys: malformed, forged or expired.
  if (error instanceof Error && error.name === 'AuthInvalidJwtError') return true;
  // Checked by the Auth server: it says this token or its session isn't valid (a 429 is only "wait").
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}
