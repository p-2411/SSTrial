import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { summary } from '@/test/fixtures';
import { UPLOAD_FILTERS, UPLOAD_FILTER_IDS, type UploadFilter, type UploadSummary } from '@label-extractor/shared';
import { UploadList } from './UploadList.tsx';

function renderList(url = '/') {
  return renderWithProviders(<UploadList />, { url });
}

afterEach(() => vi.unstubAllGlobals());

/**
 * A fake API that filters and counts like the real server, so the list can be tested end to end.
 * Returns the URLs requested.
 */
function stubApi(uploads: UploadSummary[]): string[] {
  const requested: string[] = [];
  const inView = (filter: UploadFilter) => uploads.filter((u) => (UPLOAD_FILTERS[filter] as readonly string[]).includes(u.status));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requested.push(input);
      const url = new URL(input, 'http://test');
      if (url.pathname === '/api/uploads/counts') {
        return jsonResponse({ counts: Object.fromEntries(UPLOAD_FILTER_IDS.map((id) => [id, inView(id).length])) });
      }
      return jsonResponse({ uploads: inView((url.searchParams.get('status') ?? 'all') as UploadFilter), nextCursor: null });
    }),
  );
  return requested;
}

describe('UploadList', () => {
  it('shows loading placeholders, then an empty state that invites an upload', async () => {
    stubApi([]);
    renderList();

    expect(screen.getByLabelText('Loading uploads')).toBeInTheDocument();
    expect(await screen.findByText('No uploads yet')).toBeInTheDocument();
  });

  it('shows the error and a way to retry when the list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your uploads");
    expect(screen.getByRole('alert')).toHaveTextContent("The server isn't responding right now");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows each status with what was found, why it is retrying, or why it failed', async () => {
    const uploads = [
      summary({ id: 'a', fileName: 'done.png', status: 'completed', productName: 'Maple Pecan Crunch' }),
      summary({ id: 'b', fileName: 'busy.png', status: 'processing', attempts: 2 }),
      summary({
        id: 'c',
        fileName: 'again.png',
        status: 'queued',
        attempts: 1,
        error: { code: 'LLM_RATE_LIMITED', message: 'The AI service is rate-limiting requests.' },
      }),
      summary({
        id: 'd',
        fileName: 'broken.png',
        status: 'failed',
        error: { code: 'NO_LABEL_DATA', message: "Couldn't find any product label information in this file." },
      }),
    ];
    stubApi(uploads);
    renderList();

    expect(await screen.findByText('Maple Pecan Crunch')).toBeInTheDocument();
    expect(screen.getByText('Reading label')).toBeInTheDocument();
    expect(screen.getByText('The AI service is rate-limiting requests. Retrying automatically.')).toBeInTheDocument();
    expect(screen.getByText("Couldn't find any product label information in this file.")).toBeInTheDocument();
    // Counts sit on the status tabs; statuses on each row (scoped, since tab labels share the words).
    expect(await screen.findByRole('tab', { name: 'All 4' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'In progress 2' })).toBeInTheDocument();
    const rows = within(screen.getByRole('tabpanel'));
    for (const status of ['Completed', 'Processing', 'Queued', 'Failed']) {
      expect(rows.getByText(status)).toBeInTheDocument();
    }
  });

  it('filters by the status in the URL', async () => {
    const uploads = [
      summary({ id: 'a', fileName: 'done.png', status: 'completed' }),
      summary({ id: 'b', fileName: 'broken.png', status: 'failed', error: { code: 'NO_LABEL_DATA', message: 'Nothing found.' } }),
    ];
    const requested = stubApi(uploads);
    renderList('/?status=failed');

    expect(await screen.findByText('broken.png')).toBeInTheDocument();
    // The server does the filtering; the browser only asks for the view.
    expect(requested).toContain('/api/uploads?status=failed');
    expect(screen.queryByText('done.png')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Failed/, selected: true })).toBeInTheDocument();
  });

  it('switches the list when another status tab is chosen', async () => {
    const uploads = [
      summary({ id: 'a', fileName: 'done.png', status: 'completed' }),
      summary({ id: 'b', fileName: 'broken.png', status: 'failed', error: { code: 'NO_LABEL_DATA', message: 'Nothing found.' } }),
    ];
    const requested = stubApi(uploads);
    renderList('/');
    expect(await screen.findByText('broken.png')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Completed/ }));

    expect(await screen.findByRole('tab', { name: /^Completed/, selected: true })).toBeInTheDocument();
    expect(requested).toContain('/api/uploads?status=completed');
    expect(await screen.findByText('done.png')).toBeInTheDocument();
    expect(screen.queryByText('broken.png')).not.toBeInTheDocument();
    // Counts are fetched again, so the tab's number agrees with the rows now showing.
    await vi.waitFor(() => expect(requested.filter((url) => url === '/api/uploads/counts').length).toBeGreaterThan(1));
  });

  it('shows an empty message for a filter with no matches', async () => {
    stubApi([summary({ status: 'completed' })]);
    renderList('/?status=in-progress');

    expect(await screen.findByText('Nothing is being processed right now.')).toBeInTheDocument();
  });

  it('offers CSV and JSON exports once something has completed, downloaded as the signed-in user', async () => {
    const requested = stubApi([summary({ status: 'completed' })]);
    // jsdom has no object URLs or real downloads.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    expect(screen.getByRole('menuitem', { name: /JSON/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));

    await waitFor(() => expect(requested).toContain('/api/exports/uploads.csv'));
  });

  it('hides the export menu when nothing has completed yet', async () => {
    stubApi([summary({ status: 'queued' })]);
    renderList();

    expect(await screen.findByText('Waiting to be processed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('loads the next page from the server on "Load more"', async () => {
    const first = summary({ id: 'first', fileName: 'first.png' });
    const second = summary({ id: 'second', fileName: 'second.png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://test');
        if (url.pathname === '/api/uploads/counts') return jsonResponse({ counts: { all: 2, 'in-progress': 0, completed: 2, failed: 0 } });
        return url.searchParams.get('cursor') === 'first'
          ? jsonResponse({ uploads: [second], nextCursor: null })
          : jsonResponse({ uploads: [first], nextCursor: 'first' });
      }),
    );
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('second.png')).toBeInTheDocument();
    expect(screen.getByText('first.png')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});
