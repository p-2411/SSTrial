import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpsStatusResponse } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { SystemStatusPage } from './SystemStatusPage.tsx';

afterEach(() => vi.unstubAllGlobals());

const now = new Date().toISOString();
const healthy: OpsStatusResponse = {
  health: { status: 'ok', checks: { database: { status: 'ok', latencyMs: 3 }, queue: { status: 'ok', latencyMs: 4 } } },
  worker: { lastSeenAt: now, healthy: true },
  queue: { waiting: 3, retrying: 1, processing: 2 },
  last24h: { completed: 40, failed: 2, failureRate: 2 / 42, medianSecondsToResult: 7 },
};

function renderWith(status: OpsStatusResponse) {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status)));
  renderWithProviders(<SystemStatusPage />);
}

/** The number on one of the queue's cards. */
const stat = (label: string) => within(screen.getByText(label).parentElement!).getAllByText(/./)[1]!.textContent;

describe('SystemStatusPage', () => {
  it('shows the queue, the worker, health checks and the last 24 hours', async () => {
    renderWith(healthy);

    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(stat('Waiting')).toBe('3');
    expect(stat('Retrying')).toBe('1');
    expect(stat('Processing')).toBe('2');
    expect(screen.getByText('database')).toBeInTheDocument(); // capitalised by CSS
    expect(screen.getByText('5%')).toBeInTheDocument();
  });

  it('names a failing check, and says when the worker has gone quiet', async () => {
    renderWith({
      ...healthy,
      health: { status: 'unhealthy', checks: { database: { status: 'error', latencyMs: 3000, error: 'Timed out after 3000ms' } } },
      worker: { lastSeenAt: null, healthy: false },
    });

    expect(await screen.findByText('Timed out after 3000ms')).toBeInTheDocument();
    expect(screen.getByText('Not reporting')).toBeInTheDocument();
    expect(screen.getByText('Never seen')).toBeInTheDocument();
  });
});
