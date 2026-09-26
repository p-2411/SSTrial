import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/render';
import { apiRequest, connectApi } from './client.ts';

const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
let disconnect = () => {};
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  disconnect();
});

const sentHeaders = () => (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].headers as Record<string, string>;

describe('apiRequest', () => {
  it("sends the signed-in user's current token, asking for it on every request", async () => {
    const tokens = ['first', 'refreshed'];
    disconnect = connectApi({ getAccessToken: async () => tokens.shift() ?? null, onUnauthorized: () => {} });

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
    disconnect = connectApi({ getAccessToken: async () => 'expired', onUnauthorized });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }, 401));

    await expect(apiRequest('/api/uploads')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('stops sending the token once disconnected, without undoing a newer connection', async () => {
    const first = connectApi({ getAccessToken: async () => 'first', onUnauthorized: () => {} });
    first();
    await apiRequest('/api/uploads');
    expect(sentHeaders().authorization).toBeUndefined();

    const second = connectApi({ getAccessToken: async () => 'second', onUnauthorized: () => {} });
    first(); // a stale disconnect, e.g. from a provider that has since been replaced
    await apiRequest('/api/uploads');
    expect(sentHeaders().authorization).toBe('Bearer second');
    second();
  });
});
