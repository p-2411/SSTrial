import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EventDetails, UploadHistoryEntry, UploadHistoryResponse } from '@label-extractor/shared';
import { badGateway, jsonResponse, stubFetch } from '@/test/fetch';
import { detail, historyEntry } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { UploadHistory } from './UploadHistory';

/**
 * Answers each history request with the next of `pages` (the last one repeats), an entry's details
 * with `details`, and a revert with the upload. Returns every request made.
 */
function renderHistory(pages: UploadHistoryResponse[], { canRevert = false, details }: { canRevert?: boolean; details?: EventDetails } = {}) {
  let historyRequests = 0;
  const requests = stubFetch(({ url }) => {
    if (url.endsWith('/revert')) return jsonResponse({ upload: detail({ id: 'u1', revision: 3 }) });
    if (/\/history\/\d+$/.test(url)) return jsonResponse(details);
    return jsonResponse(pages[Math.min(historyRequests++, pages.length - 1)]);
  });
  renderWithProviders(<UploadHistory upload={detail({ id: 'u1', revision: 2, canRevert })} />);
  return requests;
}

const onePage = (...entries: UploadHistoryEntry[]): UploadHistoryResponse => ({ entries, nextCursor: null });

async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'History' }));
  return screen.getByRole('region', { name: 'History' });
}

describe('UploadHistory', () => {
  it('stays collapsed, and fetches nothing, until opened', async () => {
    const requests = renderHistory([onePage(historyEntry('1', 'alice@example.com started uploading label.png.'))]);

    const toggle = screen.getByRole('button', { name: 'History' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(requests).toEqual([]);

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('alice@example.com started uploading label.png.')).toBeInTheDocument();
    expect(requests.map((request) => request.url)).toEqual(['/api/uploads/u1/history']);
  });

  it("tells the upload's story newest first, with when each thing happened", async () => {
    renderHistory([
      onePage(
        historyEntry('4', 'bob@example.com changed the brand of label.png.', { type: 'upload.edited' }),
        historyEntry('3', 'label.png read in 6.2s: Maple Pecan Crunch.', { type: 'extraction.completed' }),
        historyEntry('2', 'label.png failed on attempt 1 of 5. It will be retried.', { level: 'warn', type: 'extraction.retry_scheduled' }),
        historyEntry('1', 'alice@example.com started uploading label.png (PNG, 49 KB).'),
      ),
    ]);
    const history = await open();

    const entries = (await within(history).findAllByRole('listitem')).map((item) => item.textContent);
    expect(entries).toEqual([
      expect.stringContaining('bob@example.com changed the brand'),
      expect.stringContaining('read in 6.2s'),
      expect.stringContaining('failed on attempt 1'),
      expect.stringContaining('alice@example.com started uploading'),
    ]);
    // Each entry leads with when it happened, as a date and time rather than "3 hours ago".
    const [first] = within(history).getAllByRole('listitem');
    expect(first!.querySelector('time')!.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
    expect(first).not.toHaveTextContent(/ago/);
  });

  it('loads older entries a page at a time', async () => {
    const requests = renderHistory([
      { entries: [historyEntry('9', 'Newest.')], nextCursor: '9' },
      { entries: [historyEntry('8', 'Older.')], nextCursor: null },
    ]);
    await open();

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Older.')).toBeInTheDocument();
    expect(screen.getByText('Newest.')).toBeInTheDocument();
    expect(requests.map((request) => request.url)).toEqual(['/api/uploads/u1/history', '/api/uploads/u1/history?cursor=9']);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('is filtered by type of event, like the activity log, and offers to clear a filter nothing matches', async () => {
    const requests = renderHistory([onePage(historyEntry('1', 'label.png read.', { type: 'extraction.completed' })), onePage()]);
    await open();
    await screen.findByText('label.png read.');

    await userEvent.click(screen.getByRole('button', { name: 'Show everything' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Errors only' }));

    await vi.waitFor(() => expect(requests.at(-1)!.url).toBe('/api/uploads/u1/history?type=extraction.failed&type=extraction.abandoned'));
    expect(await screen.findByText('Nothing in the history matches these filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('fetches what a change did only when its details are opened', async () => {
    const requests = renderHistory([onePage(historyEntry('5', 'bob@example.com changed the brand of label.png.', { type: 'upload.edited', hasDetails: true }))], {
      details: { kind: 'changes', changes: [{ field: 'brand', from: 'Harvest', to: 'Harvest & Hearth' }], checked: [], unchecked: [] },
    });
    await open();

    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));

    const diff = await screen.findByRole('group', { name: 'What changed' });
    expect(within(diff).getAllByRole('listitem').map((line) => line.textContent)).toEqual(['−Removed: Harvest', '+Added: Harvest & Hearth']);
    expect(requests.map((request) => request.url)).toEqual(['/api/uploads/u1/history', '/api/uploads/u1/history/5']);
  });

  it('shows the data as it was read, as JSON', async () => {
    renderHistory([onePage(historyEntry('3', 'label.png read.', { type: 'extraction.completed', hasDetails: true }))], {
      details: { kind: 'reading', result: { productName: 'Maple Pecan Crunch', brand: null, ingredients: [], allergens: [], netWeight: null } },
    });
    await open();

    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));

    expect(await screen.findByLabelText('The data as it was read')).toHaveTextContent('"productName": "Maple Pecan Crunch"');
  });

  it("says why the history couldn't load, and tries again", async () => {
    let fail = true;
    stubFetch(() => (fail ? badGateway() : jsonResponse(onePage(historyEntry('1', 'label.png read.')))));
    renderWithProviders(<UploadHistory upload={detail({ id: 'u1' })} />);
    await open();

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the history");
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('label.png read.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when nothing was recorded', async () => {
    renderHistory([onePage()]);
    await open();
    expect(await screen.findByText(/Nothing recorded/)).toBeInTheDocument();
  });

  it('lets an admin put the data back to a point where it changed, after asking', async () => {
    const requests = renderHistory(
      [
        onePage(
          historyEntry('2', 'bob@example.com changed the brand of label.png.', { type: 'upload.edited' }), // where it is now
          historyEntry('1', 'label.png read: Maple Pecan Crunch.', { type: 'extraction.completed', revertTo: '11' }),
        ),
      ],
      { canRevert: true },
    );
    await open();
    const buttons = await screen.findAllByRole('button', { name: 'Revert' });
    expect(buttons).toHaveLength(1); // only where it changed, and not where it is now

    await userEvent.click(buttons[0]!);
    const dialog = screen.getByRole('alertdialog', { name: 'Revert to this point?' });
    expect(dialog).toHaveTextContent('checks made since are undone');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revert' }));

    await vi.waitFor(() => expect(requests.find((r) => r.url === '/api/uploads/u1/revert')?.body).toEqual({ revision: 2, versionId: '11' }));
  });

  it('offers members nothing to revert', async () => {
    renderHistory([onePage(historyEntry('1', 'label.png read.', { type: 'extraction.completed', revertTo: '11' }))]);
    await open();
    await screen.findByText('label.png read.');
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument();
  });
});
