import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test/fetch';

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('@supabase/auth-js', () => ({
  GoTrueClient: class {
    signOut = signOut;
  },
}));

const CONFIG = { supabaseUrl: 'http://supabase.test', supabasePublishableKey: 'key' };

// A fresh module for each test: it keeps the client it created.
beforeEach(() => vi.resetModules());
describe('loadSupabaseAuthClient', () => {
  it('signs out of this browser only, so others signed in to the same account stay signed in', async () => {
    stubFetch(() => jsonResponse(CONFIG));
    const { loadSupabaseAuthClient } = await import('../authClient');

    await (await loadSupabaseAuthClient()).signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it("tries again after the server couldn't be reached, rather than failing for good", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CONFIG));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const { loadSupabaseAuthClient } = await import('../authClient');

    await expect(loadSupabaseAuthClient()).rejects.toThrow("Can't reach the server");
    await expect(loadSupabaseAuthClient()).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
