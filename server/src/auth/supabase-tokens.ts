import { createClient } from '@supabase/supabase-js';
import type { VerifyAccessToken } from './authenticator.ts';

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
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data || typeof data.claims.sub !== 'string') return null;
    return data.claims.sub;
  };
}
