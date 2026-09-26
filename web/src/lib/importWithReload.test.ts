import { describe, expect, it, vi } from 'vitest';
import { importWithReload } from './importWithReload';

/** Session storage as the browser gives it, in memory. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

const failedImport = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

describe('importWithReload', () => {
  it("returns the page's code when it loads", async () => {
    const reload = vi.fn();
    await expect(importWithReload(async () => ({ Page: 'ok' }), { storage: memoryStorage(), reload })).resolves.toEqual({ Page: 'ok' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page when the code is gone (a newer build was deployed), instead of failing', async () => {
    const reload = vi.fn();
    const loading = importWithReload(failedImport, { storage: memoryStorage(), reload, now: () => 1_000 });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    // It never settles: the reload replaces the page, so nothing should render the error meanwhile.
    expect(await Promise.race([loading.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))])).toBe(
      'pending',
    );
  });

  it("lets the error through if it just reloaded for this, so a file that's really missing can't loop", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    void importWithReload(failedImport, { storage, reload, now: () => 1_000 });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

    // After the reload, the same failure a few seconds later: show it.
    await expect(importWithReload(failedImport, { storage, reload, now: () => 5_000 })).rejects.toThrow('Failed to fetch');
    expect(reload).toHaveBeenCalledOnce();

    // Much later (another deploy), reloading is worth trying again.
    void importWithReload(failedImport, { storage, reload, now: () => 120_000 });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  it('lets the error through when session storage is unavailable, rather than risk a reload loop', async () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
    };
    await expect(importWithReload(failedImport, { storage, reload })).rejects.toThrow('Failed to fetch');
    expect(reload).not.toHaveBeenCalled();
  });
});
