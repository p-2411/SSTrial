import type { CurrentMember } from '@label-extractor/shared';
import type { MemberStore } from './members.ts';

/** Checks an access token's signature and expiry; resolves to the user ID it was issued to, or null. */
export type VerifyAccessToken = (token: string) => Promise<string | null>;

export type AuthResult =
  | { outcome: 'signed-in'; member: CurrentMember }
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
      const userId = token ? await deps.verifyAccessToken(token) : null;
      if (!userId) return { outcome: 'signed-out' };
      const member = await deps.members.find(userId);
      return member ? { outcome: 'signed-in', member } : { outcome: 'no-access' };
    },
  };
}

/** `Bearer <token>` → the token; anything else → null. */
function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match ? match[1]! : null;
}
