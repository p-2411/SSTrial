import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/render';

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('@supabase/auth-js', () => ({
  GoTrueClient: class {
    signOut = signOut;
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe('loadSupabaseAuthClient', () => {
  it('signs out of this browser only, so others signed in to the same account stay signed in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ supabaseUrl: 'http://supabase.test', supabasePublishableKey: 'key' })));
    const { loadSupabaseAuthClient } = await import('./authClient');

    await (await loadSupabaseAuthClient()).signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
