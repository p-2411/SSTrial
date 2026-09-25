import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAuthHooks } from './client.ts';
import { downloadExport } from './uploads.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAuthHooks({ getAccessToken: async () => null, onUnauthorized: () => {} });
});

describe('downloadExport', () => {
  it("fetches the export as the signed-in user and saves it under the server's file name", async () => {
    setAuthHooks({ getAccessToken: async () => 'token', onUnauthorized: () => {} });
    const fetchMock = vi.fn(
      async () =>
        new Response('a,b\n', { headers: { 'content-disposition': 'attachment; filename="label-extractions-2026-09-26.csv"' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadExport('csv');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/exports/uploads.csv');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token');
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('label-extractions-2026-09-26.csv');
  });
});
