import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectApi } from './client.ts';
import { stubFetch } from '@/test/fetch';
import { fetchExport } from './uploads.ts';

let disconnect = () => {};
afterEach(() => disconnect());

describe('fetchExport', () => {
  it("fetches the export as the signed-in user, with the server's file name", async () => {
    disconnect = connectApi({ getAccessToken: async () => 'token', onUnauthorized: () => {} });
    const fetchMock = vi.fn(
      async () =>
        new Response('a,b\n', { headers: { 'content-disposition': 'attachment; filename="label-extractions-2026-09-26.csv"' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { blob, fileName } = await fetchExport('csv');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/exports/uploads.csv');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token');
    expect(fileName).toBe('label-extractions-2026-09-26.csv');
    expect(await blob.text()).toBe('a,b\n');
  });

  it("names the file after the format when the server doesn't", async () => {
    stubFetch(() => new Response('[]'));
    expect((await fetchExport('json')).fileName).toBe('uploads.json');
  });
});
