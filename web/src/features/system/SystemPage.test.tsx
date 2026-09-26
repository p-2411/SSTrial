import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpsStatusResponse } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { SystemPage } from './SystemPage.tsx';

afterEach(() => vi.unstubAllGlobals());

const now = new Date().toISOString();
const healthy: OpsStatusResponse = {
  health: { status: 'ok', checks: { database: { status: 'ok', latencyMs: 3 }, queue: { status: 'ok', latencyMs: 4 } } },
  worker: { lastSeenAt: now, healthy: true },
  queue: { waiting: 3, retrying: 1, processing: 2 },
  last24h: { completed: 40, failed: 2, failureRate: 2 / 42, medianSecondsToResult: 7 },
};

/** Answers the status with `status` (or a failure, once `opsDown`), and the activity log with nothing. */
let opsDown = false;
function renderWith(status: OpsStatusResponse) {
  opsDown = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!url.startsWith('/api/ops')) return jsonResponse({ events: [], nextCursor: null });
      return opsDown ? new Response('Bad gateway', { status: 502 }) : jsonResponse(status);
    }),
  );
  return renderWithProviders(<SystemPage />, { url: '/system' });
}

/** A figure on the status strip, by its label. */
const stat = (label: string) => within(screen.getByRole('region', { name: 'System status' })).getByText(label).parentElement!;

describe('SystemPage', () => {
  it('shows how work is flowing on one strip, above the activity log', async () => {
    renderWith(healthy);

    expect(await screen.findByRole('region', { name: 'System status' })).toBeInTheDocument();
    expect(stat('Waiting')).toHaveTextContent('3');
    expect(stat('Retrying')).toHaveTextContent('1');
    expect(stat('Processing')).toHaveTextContent('2');
    expect(stat('Read (24h)')).toHaveTextContent('40');
    expect(stat('Failed (24h)')).toHaveTextContent('5% of reads');
    expect(stat('Typical time')).toHaveTextContent('7s');
    expect(screen.getByRole('region', { name: 'Activity log' })).toBeInTheDocument();
  });

  it("sums the system's checks, workers included, up as All OK, with each one's detail on hover", async () => {
    renderWith(healthy);

    const checks = (await screen.findByText('Systems')).parentElement!;
    expect(checks).toHaveTextContent('All OK');
    expect(checks).toHaveAttribute('title', 'Database: OK, 3 ms\nQueue: OK, 4 ms\nWorkers: OK, seen just now');
  });

  it('names each failing check, workers included, and why', async () => {
    renderWith({
      ...healthy,
      health: { status: 'unhealthy', checks: { database: { status: 'error', latencyMs: 3000, error: 'Timed out after 3000ms' } } },
      worker: { lastSeenAt: null, healthy: false },
    });

    const checks = (await screen.findByText('Systems')).parentElement!;
    expect(checks).toHaveTextContent('Database and workers down');
    expect(checks).toHaveTextContent('Timed out after 3000ms');
    expect(checks).toHaveTextContent('No worker has started.');
  });

  it('names every check that fails', async () => {
    renderWith({
      ...healthy,
      health: {
        status: 'unhealthy',
        checks: {
          database: { status: 'error', latencyMs: 3000, error: 'Timed out.' },
          queue: { status: 'error', latencyMs: 3000, error: 'Refused.' },
        },
      },
    });

    expect((await screen.findByText('Systems')).parentElement!).toHaveTextContent('Database and queue down');
  });

  it("doesn't go on saying All OK unchallenged when the status can't be refreshed", async () => {
    const { client } = renderWith(healthy);
    await screen.findByText('All OK');

    opsDown = true;
    await act(() => client.invalidateQueries());

    expect(await screen.findByText(/Couldn't refresh the system status, so it may be out of date/)).toBeVisible();
    expect(screen.getByText('All OK')).toBeVisible(); // the last figures stay, with the warning above them
  });
});
