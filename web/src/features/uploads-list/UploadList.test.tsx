import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { summary } from '../../test/fixtures.ts';
import { UploadList } from './UploadList.tsx';

const noop = () => {};

function renderList(url = '/') {
  return renderWithProviders(<UploadList pending={[]} onRetryPending={noop} onDismissPending={noop} />, { url });
}

afterEach(() => vi.unstubAllGlobals());

describe('UploadList', () => {
  it('shows loading placeholders, then an empty state that invites an upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ uploads: [] })));
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
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ uploads })));
    renderList();

    expect(await screen.findByText('Maple Pecan Crunch')).toBeInTheDocument();
    expect(screen.getByText('Reading label')).toBeInTheDocument();
    expect(screen.getByText('The AI service is rate-limiting requests. Retrying automatically.')).toBeInTheDocument();
    expect(screen.getByText("Couldn't find any product label information in this file.")).toBeInTheDocument();
    expect(screen.getByText('4 files, 2 in progress')).toBeInTheDocument();
    for (const status of ['Completed', 'Processing', 'Queued', 'Failed']) {
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  });

  it('filters by the status in the URL', async () => {
    const uploads = [
      summary({ id: 'a', fileName: 'done.png', status: 'completed' }),
      summary({ id: 'b', fileName: 'broken.png', status: 'failed', error: { code: 'NO_LABEL_DATA', message: 'Nothing found.' } }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ uploads })));
    renderList('/?status=failed');

    expect(await screen.findByText('broken.png')).toBeInTheDocument();
    expect(screen.queryByText('done.png')).not.toBeInTheDocument();
    expect(screen.getByText('Failed', { selector: '[data-slot=card-title]' })).toBeInTheDocument();
  });

  it('shows an empty message for a filter with no matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ uploads: [summary({ status: 'completed' })] })));
    renderList('/?status=in-progress');

    expect(await screen.findByText('Nothing is being processed right now.')).toBeInTheDocument();
  });

  it('offers CSV and JSON exports once something has completed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ uploads: [summary({ status: 'completed' })] })));
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));

    expect(screen.getByRole('menuitem', { name: /CSV/ })).toHaveAttribute('href', '/api/exports/uploads.csv');
    expect(screen.getByRole('menuitem', { name: /JSON/ })).toHaveAttribute('href', '/api/exports/uploads.json');
  });

  it('hides the export menu when nothing has completed yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ uploads: [summary({ status: 'queued' })] })));
    renderList();

    expect(await screen.findByText('Waiting to be processed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });
});
