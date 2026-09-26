import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadHistoryEntry } from '@label-extractor/shared';
import { detail } from '@/test/fixtures';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { UploadHistory } from './UploadHistory';

afterEach(() => vi.unstubAllGlobals());

const entry = (id: string, message: string, overrides: Partial<UploadHistoryEntry> = {}): UploadHistoryEntry => ({
  id,
  occurredAt: new Date().toISOString(),
  source: 'api',
  level: 'info',
  type: 'upload.created',
  uploadId: 'u1',
  message,
  data: {},
  revertTo: null,
  ...overrides,
});

/** Answers the history with `entries`, and a revert with the upload. Returns every request made. */
function renderHistory(entries: UploadHistoryEntry[], canRevert = false) {
  const requests: Array<{ url: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return url.endsWith('/revert') ? jsonResponse({ upload: detail({ id: 'u1', revision: 3 }) }) : jsonResponse({ entries });
    }),
  );
  renderWithProviders(<UploadHistory upload={detail({ id: 'u1', revision: 2, canRevert })} />);
  return requests;
}

describe('UploadHistory', () => {
  it("tells the upload's story in order, from upload to review", async () => {
    const requests = renderHistory([
      entry('1', 'alice@example.com started uploading label.png (PNG, 49 KB).'),
      entry('2', 'label.png failed on attempt 1 of 5. It will be retried.', { level: 'warn', type: 'extraction.retry_scheduled' }),
      entry('3', 'label.png read in 6.2s: Maple Pecan Crunch.', { type: 'extraction.completed' }),
      entry('4', 'bob@example.com changed the brand of label.png.', { type: 'upload.edited' }),
    ]);

    const history = await screen.findByRole('region', { name: 'History' });
    const entries = (await within(history).findAllByRole('listitem')).map((item) => item.textContent);
    expect(entries).toEqual([
      expect.stringContaining('alice@example.com started uploading'),
      expect.stringContaining('failed on attempt 1'),
      expect.stringContaining('read in 6.2s'),
      expect.stringContaining('bob@example.com changed the brand'),
    ]);
    expect(requests[0]!.url).toBe('/api/uploads/u1/history');
    // Each entry leads with when it happened, as a date and time rather than "3 hours ago".
    const [first] = await within(history).findAllByRole('listitem');
    expect(first!.querySelector('time')!.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
    expect(first).not.toHaveTextContent(/ago/);
  });

  it('says so when nothing was recorded', async () => {
    renderHistory([]);
    expect(await screen.findByText(/Nothing recorded/)).toBeInTheDocument();
  });

  it('lets an admin put the data back to a point where it changed, after asking', async () => {
    const requests = renderHistory(
      [
        entry('1', 'label.png read: Maple Pecan Crunch.', { type: 'extraction.completed', revertTo: '11' }),
        entry('2', 'bob@example.com changed the brand of label.png.', { type: 'upload.edited' }), // where it is now
      ],
      true,
    );
    const buttons = await screen.findAllByRole('button', { name: 'Revert' });
    expect(buttons).toHaveLength(1); // only where it changed, and not where it is now

    await userEvent.click(buttons[0]!);
    const dialog = screen.getByRole('alertdialog', { name: 'Revert to this point?' });
    expect(dialog).toHaveTextContent('checks made since are undone');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revert' }));

    await vi.waitFor(() => expect(requests.find((r) => r.url === '/api/uploads/u1/revert')?.body).toEqual({ revision: 2, versionId: '11' }));
  });

  it("offers members nothing to revert", async () => {
    renderHistory([entry('1', 'label.png read.', { type: 'extraction.completed', revertTo: '11' })], false);
    await screen.findByText('label.png read.');
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument();
  });
});
