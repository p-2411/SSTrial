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

  it("answers 503 and names the failing dependency when not, without the error's details", async () => {
    const unhealthy = { status: 'unhealthy' as const, checks: { database: { status: 'error' as const, latencyMs: 3000, error: 'Timed out after 3000ms' } } };
    app = await buildApp(testAppDeps({ health: async () => unhealthy }));

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.database).toEqual({ status: 'error', latencyMs: 3000 });
  });
});

describe('GET /api/ops', () => {
  it('combines health with the queue, the worker and throughput', async () => {
    app = await buildApp(testAppDeps());
    const response = await app.inject({ method: 'GET', url: '/api/ops' });
    expect(response.json()).toEqual({
      health: HEALTHY,
      worker: { lastSeenAt: null, healthy: false },
      queue: { waiting: 0, retrying: 0, processing: 0 },
      last24h: { completed: 0, failed: 0, failureRate: null, medianSecondsToResult: null },
    });
  });

  it('shapes stored figures for the page: rates, whole seconds and ISO dates', async () => {
    const seen = new Date('2026-09-25T01:00:00Z');
    app = await buildApp(
      testAppDeps({
        ops: {
          snapshot: async () => ({
            ...EMPTY_OPS_SNAPSHOT,
            worker: { lastSeenAt: seen, healthy: true },
            queue: { waiting: 2, retrying: 1, processing: 1 },
            recent: { completed: 3, failed: 1, medianSecondsToResult: 7.4 },
          }),
        },
      }),
    );

    const body = (await app.inject({ method: 'GET', url: '/api/ops' })).json();

    expect(body.worker).toEqual({ lastSeenAt: seen.toISOString(), healthy: true });
    expect(body.queue).toEqual({ waiting: 2, retrying: 1, processing: 1 });
    expect(body.last24h).toEqual({ completed: 3, failed: 1, failureRate: 0.25, medianSecondsToResult: 7 });
  });
});
