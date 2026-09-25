import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/api/app.ts';
import { EMPTY_OPS_SNAPSHOT, HEALTHY, testAppDeps } from '../fakes.ts';

let app: App;
afterEach(() => app.close());

describe('GET /api/health', () => {
  it('answers 200 with the check results when healthy', async () => {
    app = await buildApp(testAppDeps());
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(HEALTHY);
  });

  it('answers 503 and names the failing dependency when not', async () => {
    const unhealthy = { status: 'unhealthy' as const, checks: { database: { status: 'error' as const, latencyMs: 3000, error: 'Timed out after 3000ms' } } };
    app = await buildApp(testAppDeps({ health: async () => unhealthy }));

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.database.error).toBe('Timed out after 3000ms');
  });
});

describe('GET /api/ops', () => {
  it('combines health with queue, throughput and alert data', async () => {
    app = await buildApp(testAppDeps());
    const response = await app.inject({ method: 'GET', url: '/api/ops' });
    expect(response.json()).toEqual({
      generatedAt: expect.any(String),
      health: HEALTHY,
      worker: { lastSeenAt: null, healthy: false },
      queue: { waiting: 0, retrying: 0, processing: 0, oldestWaitingSeconds: null },
      last24h: { completed: 0, failed: 0, failureRate: null, medianSecondsToResult: null },
      failuresByReason: [],
      alerts: { open: [], recent: [] },
    });
  });

  it('shapes stored figures for the page: messages, rates, whole seconds and ISO dates', async () => {
    const seen = new Date('2026-09-25T01:00:00Z');
    const alert = { id: 1, key: 'queue-stalled', severity: 'critical' as const, title: 'T', message: 'M', occurrences: 3, firstSeenAt: seen, lastSeenAt: seen, resolvedAt: null };
    app = await buildApp(
      testAppDeps({
        ops: {
          snapshot: async () => ({
            ...EMPTY_OPS_SNAPSHOT,
            worker: { lastSeenAt: seen, healthy: true },
            queue: { waiting: 2, retrying: 1, processing: 1, oldestWaitingSeconds: 61.6 },
            recent: { completed: 3, failed: 1, medianSecondsToResult: 7.4 },
            // A code this version no longer knows reads as INTERNAL_ERROR, and is counted with it.
            failures: [{ code: 'INTERNAL_ERROR', count: 1 }, { code: 'INTERNAL_ERROR', count: 1 }, { code: 'LLM_TIMEOUT', count: 1 }],
            alerts: { open: [alert], recent: [] },
          }),
        },
      }),
    );

    const body = (await app.inject({ method: 'GET', url: '/api/ops' })).json();

    expect(body.worker).toEqual({ lastSeenAt: seen.toISOString(), healthy: true });
    expect(body.queue.oldestWaitingSeconds).toBe(62);
    expect(body.last24h).toEqual({ completed: 3, failed: 1, failureRate: 0.25, medianSecondsToResult: 7 });
    expect(body.failuresByReason).toEqual([
      { code: 'INTERNAL_ERROR', message: expect.any(String), count: 2 },
      { code: 'LLM_TIMEOUT', message: 'The AI service took too long to respond.', count: 1 },
    ]);
    expect(body.alerts.open[0]).toMatchObject({ key: 'queue-stalled', firstSeenAt: seen.toISOString(), resolvedAt: null });
  });
});
