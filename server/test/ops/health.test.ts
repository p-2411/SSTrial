import { describe, expect, it } from 'vitest';
import { runHealthChecks } from '../../src/ops/health.ts';

describe('runHealthChecks', () => {
  it('is ok when every check passes', async () => {
    const report = await runHealthChecks([{ name: 'database', run: async () => {} }]);
    expect(report).toMatchObject({ status: 'ok', checks: { database: { status: 'ok' } } });
  });

  it('is unhealthy and says which dependency failed, and why', async () => {
    const report = await runHealthChecks([
      { name: 'database', run: async () => {} },
      { name: 'queue', run: async () => { throw new Error('relation "pgboss.queue" does not exist'); } },
    ]);
    expect(report).toMatchObject({
      status: 'unhealthy',
      checks: { database: { status: 'ok' }, queue: { status: 'error', error: 'relation "pgboss.queue" does not exist' } },
    });
  });

  it('treats a hung dependency as a failure instead of hanging the probe', async () => {
    const report = await runHealthChecks([{ name: 'database', run: () => new Promise(() => {}) }]);
    expect(report.checks.database).toMatchObject({ status: 'error', error: 'Timed out after 3000ms' });
  }, 10_000);
});
