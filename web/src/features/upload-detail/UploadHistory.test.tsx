import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { UploadHistory } from './UploadHistory';

afterEach(() => vi.unstubAllGlobals());

const event = (id: string, message: string, overrides: Partial<LogEvent> = {}): LogEvent => ({
  id,
  occurredAt: new Date().toISOString(),
  source: 'api',
  level: 'info',
  type: 'upload.created',
  uploadId: 'u1',
  message,
  data: {},
  ...overrides,
});

function renderHistory(events: LogEvent[]) {
  const fetch = vi.fn(async () => jsonResponse({ events }));
  vi.stubGlobal('fetch', fetch);
  renderWithProviders(<UploadHistory uploadId="u1" />);
  return fetch;
}

describe('UploadHistory', () => {
  it("tells the upload's story in order, from upload to review", async () => {
    const fetch = renderHistory([
      event('1', 'alice@example.com started uploading label.png (PNG, 49 KB).'),
      event('2', 'label.png failed on attempt 1 of 5. It will be retried.', { level: 'warn', type: 'extraction.retry_scheduled' }),
      event('3', 'label.png read in 6.2s: Maple Pecan Crunch.', { type: 'extraction.completed' }),
      event('4', 'bob@example.com changed the brand of label.png.', { type: 'upload.edited' }),
    ]);

    const history = await screen.findByRole('region', { name: 'History' });
    const entries = (await within(history).findAllByRole('listitem')).map((entry) => entry.textContent);
    expect(entries).toEqual([
      expect.stringContaining('alice@example.com started uploading'),
      expect.stringContaining('failed on attempt 1'),
      expect.stringContaining('read in 6.2s'),
      expect.stringContaining('bob@example.com changed the brand'),
    ]);
    expect(fetch).toHaveBeenCalledWith('/api/uploads/u1/history', expect.anything());
    // Each entry leads with when it happened, as a date and time rather than "3 hours ago".
    const [first] = await within(history).findAllByRole('listitem');
    expect(first!.querySelector('time')!.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
    expect(first).not.toHaveTextContent(/ago/);
  });

  it('says so when nothing was recorded', async () => {
    renderHistory([]);
    expect(await screen.findByText(/Nothing recorded/)).toBeInTheDocument();
  });
});
