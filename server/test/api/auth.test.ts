import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/api/app.ts';
import { createAuthenticator } from '../../src/auth/authenticator.ts';
import { AuthUnavailableError } from '../../src/auth/supabase-tokens.ts';
import { ADMIN, MEMBER, TEST_PUBLIC_CONFIG, testAppDeps } from '../fakes.ts';

// The real header parsing and member check; tokens are plain strings mapped to users.
const authenticator = createAuthenticator({
  verifyAccessToken: async (token) =>
    ({ 'admin-token': ADMIN.id, 'member-token': MEMBER.id, 'stranger-token': 'user-stranger' })[token] ?? null,
  members: { find: async (id) => [ADMIN, MEMBER].find((m) => m.id === id) ?? null },
});

let app: App;
beforeEach(async () => {
  app = await buildApp(testAppDeps({ authenticator }));
});
afterEach(() => app.close());

const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('signing in', () => {
  it('refuses API requests without a valid sign-in', async () => {
    for (const token of [undefined, 'forged-token']) {
      const response = await get('/api/uploads', token);
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('cannot be skipped by spelling the path differently (the router decodes it; the check must too)', async () => {
    for (const url of ['/%61pi/uploads', '/a%70i/uploads/counts', '/%61pi/exports/uploads.csv', '/%61pi/me']) {
      expect((await get(url)).statusCode, url).toBe(401);
    }
  });

  it("answers 503 when sign-ins can't be checked, so a Supabase Auth outage doesn't sign everyone out", async () => {
    await app.close();
    const down = { authenticate: async () => Promise.reject(new AuthUnavailableError('Auth is down')) };
    app = await buildApp(testAppDeps({ authenticator: down }));

    const response = await get('/api/uploads', 'member-token');
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('AUTH_UNAVAILABLE');
  });

  it('refuses a valid sign-in that has no access', async () => {
    const response = await get('/api/uploads', 'stranger-token');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('lets members in, and tells the app who they are', async () => {
    expect((await get('/api/uploads', 'member-token')).statusCode).toBe(200);
    expect((await get('/api/me', 'member-token')).json()).toEqual(MEMBER);
  });

  it('keeps the health check and the sign-in config public', async () => {
    expect((await get('/api/health')).statusCode).toBe(200);
    const config = await get('/api/config');
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual(TEST_PUBLIC_CONFIG);
  });
});

describe('roles', () => {
  it.each(['/api/ops', '/api/logs'])('only lets admins see %s', async (url) => {
    const asMember = await get(url, 'member-token');
    expect(asMember.statusCode).toBe(403);
    expect(asMember.json().error.code).toBe('FORBIDDEN');
    expect((await get(url, 'admin-token')).statusCode).toBe(200);
  });
});
