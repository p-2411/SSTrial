import { describe, expect, it } from 'vitest';
import { createAuthenticator } from '../../src/auth/authenticator.ts';

const ALICE = { id: 'user-alice', email: 'alice@example.com', role: 'member' as const };

/** Tokens are plain strings here: 'good' is Alice's, 'stranger' is a valid sign-in without access. */
const authenticator = createAuthenticator({
  verifyAccessToken: async (token) => ({ good: ALICE.id, stranger: 'user-stranger' })[token] ?? null,
  members: { find: async (id) => (id === ALICE.id ? ALICE : null) },
});

describe('authenticate', () => {
  it('signs in a member with a valid bearer token', async () => {
    await expect(authenticator.authenticate('Bearer good')).resolves.toEqual({ outcome: 'signed-in', member: ALICE });
  });

  it.each([undefined, '', 'good', 'Basic good', 'Bearer', 'Bearer bad'])('treats %j as signed out', async (header) => {
    await expect(authenticator.authenticate(header)).resolves.toEqual({ outcome: 'signed-out' });
  });

  it('recognises a valid sign-in that has no access', async () => {
    await expect(authenticator.authenticate('Bearer stranger')).resolves.toEqual({ outcome: 'no-access' });
  });
});
