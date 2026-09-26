import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadSummary } from '@label-extractor/shared';
import { uploadKeys } from '@/api/queries';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { summary } from '@/test/fixtures';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { UploadStage } from './UploadStage.tsx';

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
  renderWithProviders(<UploadStage pending={pending} onUpload={() => {}} onRetry={() => {}} onDismiss={() => {}} />);

describe('UploadStage', () => {
  it("asks for the person's own uploads being read, and shows just the drop area when there are none", async () => {
    mine = [];
    const fetch = stubMine();
    renderYours();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/uploads?view=upload', expect.anything()));
    const card = screen.getByRole('region', { name: 'Upload' });
    expect(within(card).getByRole('button', { name: 'Choose files' })).toBeInTheDocument();
    expect(within(card).queryByRole('list', { name: 'Uploading' })).not.toBeInTheDocument();
  });

  it("lists files still being sent, then the server's, under the drop area", async () => {
    mine = [
      summary({ id: 'q', fileName: 'waiting.png', status: 'queued', productName: null }),
      summary({ id: 'f', fileName: 'broken.png', status: 'failed', productName: null, error: { code: 'LLM_TIMEOUT', message: 'The AI service took too long to respond.' } }),
    ];
    stubMine();
    renderYours([sending('sending.png')]);

    const rows = within(screen.getByRole('region', { name: 'Upload' })).getByRole('list', { name: 'Uploading' });
    await within(rows).findByText('waiting.png');
    expect(within(rows).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('sending.png'),
      expect.stringContaining('waiting.png'),
      expect.stringContaining('broken.png'),
    ]);
  });

  it('opens a failed upload, but not one still being worked on', async () => {
    mine = [
      summary({ id: 'q', fileName: 'waiting.png', status: 'queued', productName: null }),
      summary({ id: 'f', fileName: 'broken.png', status: 'failed', productName: null, error: { code: 'LLM_TIMEOUT', message: 'Timed out.' } }),
    ];
    stubMine();
    renderYours();

    const card = screen.getByRole('region', { name: 'Upload' });
    await within(card).findByText('waiting.png');
    const links = within(card).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('broken.png');
  });

  it('announces an upload that has been read, as it leaves for Review', async () => {
    mine = [summary({ id: 'q', fileName: 'granola.png', status: 'processing', productName: null })];
    stubMine();
    const { client } = renderYours();
    await screen.findByText('granola.png');

    mine = [];
    await act(() => client.invalidateQueries({ queryKey: uploadKeys.lists() }));

    expect(await screen.findByText('granola.png is ready to review.')).toBeInTheDocument();
  });
});
