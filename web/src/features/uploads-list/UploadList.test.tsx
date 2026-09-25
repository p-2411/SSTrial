import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithProviders } from '../../test/render.tsx';
import { summary } from '../../test/fixtures.ts';
import { UploadList } from './UploadList.tsx';

const noop = () => {};

function renderList() {
  return renderWithProviders(<UploadList pending={[]} onRetryPending={noop} onDismissPending={noop} />);
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
    expect(screen.getByText('Reading label, attempt 2 of 5')).toBeInTheDocument();
    expect(screen.getByText('The AI service is rate-limiting requests. Retrying automatically.')).toBeInTheDocument();
    expect(screen.getByText("Couldn't find any product label information in this file.")).toBeInTheDocument();
    expect(screen.getByText('4 files, 2 in progress')).toBeInTheDocument();
    for (const status of ['Completed', 'Processing', 'Queued', 'Failed']) {
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  });
});
