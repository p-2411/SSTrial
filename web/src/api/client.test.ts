import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/render';
import { apiRequest, setAuthHooks } from './client.ts';

const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  setAuthHooks({ getAccessToken: async () => null, onUnauthorized: () => {} });
});

const sentHeaders = () => (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].headers as Record<string, string>;

describe('apiRequest', () => {
  it("sends the signed-in user's current token, asking for it on every request", async () => {
    const tokens = ['first', 'refreshed'];
    setAuthHooks({ getAccessToken: async () => tokens.shift() ?? null, onUnauthorized: () => {} });

    await apiRequest('/api/uploads');
    expect(sentHeaders().authorization).toBe('Bearer first');
    await apiRequest('/api/uploads');
    expect(sentHeaders().authorization).toBe('Bearer refreshed');
  });

  it('sends no token when nobody is signed in', async () => {
    await apiRequest('/api/config');
    expect(sentHeaders().authorization).toBeUndefined();
  });

  it('reports a refused sign-in, and still fails the request', async () => {
    const onUnauthorized = vi.fn();
    setAuthHooks({ getAccessToken: async () => 'expired', onUnauthorized });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }, 401));

    await expect(apiRequest('/api/uploads')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
