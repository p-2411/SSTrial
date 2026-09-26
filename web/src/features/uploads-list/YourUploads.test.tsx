import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadSummary } from '@label-extractor/shared';
import { uploadKeys } from '@/api/queries';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { summary } from '@/test/fixtures';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { YourUploads } from './YourUploads.tsx';

afterEach(() => vi.unstubAllGlobals());

let mine: UploadSummary[] = [];
function stubMine() {
  const fetch = vi.fn(async () => jsonResponse({ uploads: mine, nextCursor: null }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const sending = (name: string): PendingUpload => ({
  localId: name,
  file: new File(['x'], name, { type: 'image/png' }),
  mimeType: 'image/png',
  phase: 'uploading',
  progress: 0.4,
  error: null,
});

const renderYours = (pending: PendingUpload[] = []) =>
  renderWithProviders(<YourUploads pending={pending} onRetry={() => {}} onDismiss={() => {}} />);

describe('YourUploads', () => {
  it("asks for the person's own unfinished uploads, and shows nothing when there are none", async () => {
    mine = [];
    const fetch = stubMine();
    renderYours();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/uploads?view=mine', expect.anything()));
    expect(screen.queryByRole('region', { name: 'Your uploads' })).not.toBeInTheDocument();
  });

  it("lists files still being sent, then the server's, saying only this person can see them", async () => {
    mine = [
      summary({ id: 'q', fileName: 'waiting.png', status: 'queued', productName: null }),
      summary({ id: 'f', fileName: 'broken.png', status: 'failed', productName: null, error: { code: 'LLM_TIMEOUT', message: 'The AI service took too long to respond.' } }),
    ];
    stubMine();
    renderYours([sending('sending.png')]);

    const card = await screen.findByRole('region', { name: 'Your uploads' });
    await within(card).findByText('waiting.png');
    expect(within(card).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('sending.png'),
      expect.stringContaining('waiting.png'),
      expect.stringContaining('broken.png'),
    ]);
    expect(within(card).getByText('Only you can see these')).toBeInTheDocument();
  });

  it('opens a failed upload, but not one still being worked on', async () => {
    mine = [
      summary({ id: 'q', fileName: 'waiting.png', status: 'queued', productName: null }),
      summary({ id: 'f', fileName: 'broken.png', status: 'failed', productName: null, error: { code: 'LLM_TIMEOUT', message: 'Timed out.' } }),
    ];
    stubMine();
    renderYours();

    const card = await screen.findByRole('region', { name: 'Your uploads' });
    await within(card).findByText('waiting.png');
    const links = within(card).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('broken.png');
  });

  it('announces an upload that has finished, as it leaves for Products', async () => {
    mine = [summary({ id: 'q', fileName: 'granola.png', status: 'processing', productName: null })];
    stubMine();
    const { client } = renderYours();
    await screen.findByText('granola.png');

    mine = [];
    await act(() => client.invalidateQueries({ queryKey: uploadKeys.lists() }));

    expect(await screen.findByText('granola.png is ready.')).toBeInTheDocument();
  });
});
