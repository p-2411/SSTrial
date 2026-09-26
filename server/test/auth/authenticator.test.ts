import { describe, expect, it } from 'vitest';
import { createAuthenticator } from '../../src/auth/authenticator.ts';

const ALICE = { id: 'user-alice', email: 'alice@example.com', role: 'member' as const };
const EXPIRES = new Date('2026-09-26T10:00:00Z');

/** Tokens are plain strings here: 'good' is Alice's, 'stranger' is a valid sign-in without access. */
const authenticator = createAuthenticator({
  verifyAccessToken: async (token) => {
    const userId = ({ good: ALICE.id, stranger: 'user-stranger' } as Record<string, string>)[token];
    return userId ? { userId, expiresAt: EXPIRES } : null;
  },
  members: { find: async (id) => (id === ALICE.id ? ALICE : null) },
});

describe('authenticate', () => {
  it('signs in a member with a valid bearer token, until the token runs out', async () => {
    await expect(authenticator.authenticate('Bearer good')).resolves.toEqual({ outcome: 'signed-in', member: ALICE, expiresAt: EXPIRES });
  });

  it.each([undefined, '', 'good', 'Basic good', 'Bearer', 'Bearer bad'])('treats %j as signed out', async (header) => {
    await expect(authenticator.authenticate(header)).resolves.toEqual({ outcome: 'signed-out' });
  });

  it('recognises a valid sign-in that has no access', async () => {
    await expect(authenticator.authenticate('Bearer stranger')).resolves.toEqual({ outcome: 'no-access' });
  });
});
