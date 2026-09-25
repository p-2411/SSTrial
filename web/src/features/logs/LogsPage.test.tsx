import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListLogsResponse, LogEvent } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { LogsPage } from './LogsPage.tsx';

afterEach(() => vi.unstubAllGlobals());

const UPLOAD = '9e1b7c2a-0000-4000-8000-000000000001';

function event(overrides: Partial<LogEvent> & Pick<LogEvent, 'id' | 'message'>): LogEvent {
  return {
    occurredAt: new Date().toISOString(),
    source: 'worker',
    level: 'info',
    type: 'extraction.started',
    uploadId: UPLOAD,
    data: { fileName: 'oat-milk.png' },
    ...overrides,
  };
}

/** Answers every request with the next of `pages` (the last one repeats). Returns the URLs requested. */
function stubLogs(...pages: ListLogsResponse[]): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requested.push(input);
      return jsonResponse(pages[Math.min(requested.length - 1, pages.length - 1)]);
    }),
  );
  return requested;
}

const renderPage = (url = '/logs') => renderWithProviders(<LogsPage />, { url });

describe('LogsPage', () => {
  it('shows events newest first under their day, with warnings and errors marked', async () => {
    stubLogs({
      events: [
        event({ id: '3', level: 'error', type: 'extraction.failed', message: 'oat-milk.png failed: The AI service took too long.', data: { fileName: 'oat-milk.png', code: 'LLM_TIMEOUT' } }),
        event({ id: '2', level: 'warn', type: 'extraction.retry_scheduled', message: 'oat-milk.png failed on attempt 1 of 5.' }),
        event({ id: '1', source: 'api', type: 'upload.created', message: 'oat-milk.png started uploading.' }),
      ],
      nextCursor: null,
    });
    renderPage();

    expect(screen.getByLabelText('Loading the activity log')).toBeInTheDocument();
    const today = await screen.findByRole('region', { name: 'Today' });
    const rows = within(today).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByText(/oat-milk\.png/).textContent)).toEqual([
      'oat-milk.png failed: The AI service took too long.',
      'oat-milk.png failed on attempt 1 of 5.',
      'oat-milk.png started uploading.',
    ]);
    expect(within(rows[0]!).getByText('Error')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Warning')).toBeInTheDocument();
    expect(within(rows[2]!).queryByText(/Warning|Error/)).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText('Upload started')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('API')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'View upload' })).toHaveAttribute('href', `/uploads/${UPLOAD}`);
  });

  it("doesn't link to an upload that was deleted", async () => {
    stubLogs({ events: [event({ id: '1', level: 'warn', type: 'upload.rejected', message: 'notes.txt was deleted.' })], nextCursor: null });
    renderPage();

    await screen.findByText('notes.txt was deleted.');
    expect(screen.queryByRole('link', { name: 'View upload' })).not.toBeInTheDocument();
  });

  it('shows the structured details on request', async () => {
    const user = userEvent.setup();
    stubLogs({ events: [event({ id: '1', message: 'Reading oat-milk.png.', data: { fileName: 'oat-milk.png', attempt: 2 } })], nextCursor: null });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Details' }));

    expect(screen.getByText(/"attempt": 2/)).toBeInTheDocument();
  });

  it('asks the server for the chosen level', async () => {
    const user = userEvent.setup();
    const requested = stubLogs({ events: [event({ id: '1', message: 'Reading oat-milk.png.' })], nextCursor: null });
    renderPage();
    await screen.findByText('Reading oat-milk.png.');

    await user.click(screen.getByRole('tab', { name: 'Errors only' }));

    expect(screen.getByRole('tab', { name: 'Errors only' })).toHaveAttribute('aria-selected', 'true');
    await vi.waitFor(() => expect(requested.at(-1)).toBe('/api/logs?level=error'));
  });

  it('applies the filters in the URL, naming the upload, and can drop the upload filter', async () => {
    const user = userEvent.setup();
    const requested = stubLogs({ events: [event({ id: '1', type: 'extraction.failed', level: 'error', message: 'oat-milk.png failed.' })], nextCursor: null });
    renderPage(`/logs?type=extraction.failed&upload=${UPLOAD}`);

    expect(await screen.findByRole('link', { name: 'oat-milk.png' })).toHaveAttribute('href', `/uploads/${UPLOAD}`);
    expect(screen.getByRole('button', { name: /Extraction failed/ })).toBeInTheDocument();
    expect(requested[0]).toBe(`/api/logs?type=extraction.failed&upload=${UPLOAD}`);

    await user.click(screen.getByRole('button', { name: 'Show events for every upload' }));

    await vi.waitFor(() => expect(requested.at(-1)).toBe('/api/logs?type=extraction.failed'));
  });

  it('loads older events a page at a time', async () => {
    const user = userEvent.setup();
    const requested = stubLogs(
      { events: [event({ id: '5', message: 'Newest.' })], nextCursor: '5' },
      { events: [event({ id: '4', message: 'Older.' })], nextCursor: null },
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Load older events' }));

    expect(await screen.findByText('Older.')).toBeInTheDocument();
    expect(screen.getByText('Newest.')).toBeInTheDocument();
    expect(requested).toEqual(['/api/logs', '/api/logs?cursor=5']);
    expect(screen.queryByRole('button', { name: 'Load older events' })).not.toBeInTheDocument();
  });

  it('offers to clear the filters when nothing matches them', async () => {
    const user = userEvent.setup();
    const requested = stubLogs({ events: [], nextCursor: null });
    renderPage('/logs?level=error');

    expect(await screen.findByText('No events match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show every event' }));

    await vi.waitFor(() => expect(requested.at(-1)).toBe('/api/logs'));
    expect(await screen.findByText('Nothing has happened yet')).toBeInTheDocument();
  });

  it('explains an upload with no history', async () => {
    stubLogs({ events: [], nextCursor: null });
    renderPage(`/logs?upload=${UPLOAD}`);

    expect(await screen.findByText('Nothing recorded for this upload')).toBeInTheDocument();
    expect(screen.getByText(/uploads from before the activity log existed have none/)).toBeInTheDocument();
  });

  it('shows the error and a way to retry when the log cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the activity log");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
