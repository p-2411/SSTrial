import type { CurrentMember } from '@label-extractor/shared';
import type { MemberStore } from './members.ts';

/**
 * A token couldn't be checked right now: Supabase Auth is unreachable, failing or rate-limiting.
 * Not the same as an invalid token: answering "signed out" here would sign every user out during
 * an Auth outage, so the API answers 503 instead and people stay signed in.
 */
export class AuthUnavailableError extends Error {
  override name = 'AuthUnavailableError';
}

/** Who a valid access token was issued to, and until when it's valid. */
export interface VerifiedToken {
  userId: string;
  expiresAt: Date | null;
}

/**
 * Checks an access token's signature and expiry. Resolves to who it was issued to, or null for a
 * token that isn't valid; throws AuthUnavailableError when it can't be checked right now.
 */
export type VerifyAccessToken = (token: string) => Promise<VerifiedToken | null>;

export type AuthResult =
  /** `expiresAt`: when the token runs out, for anything that outlives one request (a live stream). */
  | { outcome: 'signed-in'; member: CurrentMember; expiresAt: Date | null }
  /** No token, or one that isn't valid (forged, expired, malformed). */
  | { outcome: 'signed-out' }
  /** A valid sign-in, but this person hasn't been given access. */
  | { outcome: 'no-access' };

export interface Authenticator {
  /** Who is making a request, from its `Authorization` header. */
  authenticate(authorization: string | undefined): Promise<AuthResult>;
}

export function createAuthenticator(deps: {
  verifyAccessToken: VerifyAccessToken;
  members: Pick<MemberStore, 'find'>;
}): Authenticator {
  return {
    async authenticate(authorization) {
      const token = bearerToken(authorization);
      const verified = token ? await deps.verifyAccessToken(token) : null;
      if (!verified) return { outcome: 'signed-out' };
      const member = await deps.members.find(verified.userId);
      return member ? { outcome: 'signed-in', member, expiresAt: verified.expiresAt } : { outcome: 'no-access' };
    },
  };
}

/** `Bearer <token>` → the token; anything else → null. */
function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match ? match[1]! : null;
}
