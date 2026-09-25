import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpsStatusResponse } from '@label-extractor/shared';
import { jsonResponse, renderWithProviders } from '@/test/render';
import { SystemStatusPage } from './SystemStatusPage.tsx';

afterEach(() => vi.unstubAllGlobals());

const now = new Date().toISOString();
const healthy: OpsStatusResponse = {
  generatedAt: now,
  health: { status: 'ok', checks: { database: { status: 'ok', latencyMs: 3 }, queue: { status: 'ok', latencyMs: 4 } } },
  worker: { lastSeenAt: now, healthy: true },
  queue: { waiting: 3, retrying: 1, processing: 2, oldestWaitingSeconds: 45 },
  last24h: { completed: 40, failed: 2, failureRate: 2 / 42, medianSecondsToResult: 7 },
  failuresByReason: [{ code: 'LLM_TIMEOUT', message: 'The AI service took too long to respond.', count: 2 }],
  alerts: { open: [], recent: [] },
};

function renderWith(status: OpsStatusResponse) {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status)));
  renderWithProviders(<SystemStatusPage />);
}

describe('SystemStatusPage', () => {
  it('shows health, the queue, the last 24 hours and failures by reason', async () => {
    renderWith(healthy);

    expect(await screen.findByText('All systems working')).toBeInTheDocument();
    expect(screen.getByText('1 waiting to retry')).toBeInTheDocument();
    expect(screen.getByText('45s')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('The AI service took too long to respond.')).toBeInTheDocument();
  });

  it('says something is broken when a check fails or the worker has gone quiet, and names the failure', async () => {
    renderWith({
      ...healthy,
      health: { status: 'unhealthy', checks: { database: { status: 'error', latencyMs: 3000, error: 'Timed out after 3000ms' } } },
      worker: { lastSeenAt: null, healthy: false },
    });

    expect(await screen.findByText('Something is broken')).toBeInTheDocument();
    expect(screen.getByText('Timed out after 3000ms')).toBeInTheDocument();
    expect(screen.getByText('Not reporting')).toBeInTheDocument();
  });

  it('lists open alerts before resolved ones', async () => {
    renderWith({
      ...healthy,
      alerts: {
        open: [{ id: 2, key: 'queue-stalled', severity: 'critical', title: 'Uploads are not being processed', message: 'Waited 14 minutes.', occurrences: 3, firstSeenAt: now, lastSeenAt: now, resolvedAt: null }],
        recent: [{ id: 1, key: 'failure-rate', severity: 'warning', title: 'High failure rate', message: '3 of 5 failed.', occurrences: 2, firstSeenAt: now, lastSeenAt: now, resolvedAt: now }],
      },
    });

    expect(await screen.findByText('Something is broken')).toBeInTheDocument();
    const titles = screen.getAllByText(/Uploads are not being processed|High failure rate/).map((el) => el.textContent);
    expect(titles).toEqual(['Uploads are not being processed', 'High failure rate']);
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });
});
