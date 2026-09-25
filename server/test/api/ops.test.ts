import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/api/app.ts';
import { EMPTY_OPS_STATUS, HEALTHY, testAppDeps } from '../fakes.ts';

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
    expect(response.json()).toEqual({ generatedAt: expect.any(String), health: HEALTHY, ...EMPTY_OPS_STATUS });
  });
});
