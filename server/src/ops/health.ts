import type postgres from 'postgres';
import type { PgBoss } from 'pg-boss';
import type { HealthCheckResult, HealthReport } from '@label-extractor/shared';
import { EXTRACTION_QUEUE } from '../uploads/jobs.ts';

/**
 * Readiness checks behind GET /api/health on the API and the worker. Railway runs them before
 * switching traffic to a new deployment; anyone can run them to see what's wrong.
 */
export interface HealthCheck {
  name: string;
  /** Resolves if healthy; throws (with a useful message) if not. */
  run(): Promise<void>;
}

/** Each check gets this long; a hung dependency counts as a failure rather than hanging the probe. */
const CHECK_TIMEOUT_MS = 3_000;

export async function runHealthChecks(checks: HealthCheck[]): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (check): Promise<[string, HealthCheckResult]> => {
      const started = performance.now();
      try {
        await withTimeout(check.run(), CHECK_TIMEOUT_MS);
        return [check.name, { status: 'ok', latencyMs: Math.round(performance.now() - started) }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [check.name, { status: 'error', latencyMs: Math.round(performance.now() - started), error: message }];
      }
    }),
  );
  return {
    status: results.every(([, result]) => result.status === 'ok') ? 'ok' : 'unhealthy',
    checks: Object.fromEntries(results),
  };
}

/**
 * 200 when every check passes, 503 otherwise — the status code is what load balancers and Railway's
 * deploy checks look at; the body says which dependency failed.
 */
export function healthStatusCode(report: HealthReport): 200 | 503 {
  return report.status === 'ok' ? 200 : 503;
}

/**
 * The report for anyone who asks (the public GET /api/health): which checks failed, but not the
 * error text, which can name hosts or internals. Admins see it in full on the status page.
 */
export function publicHealthReport(report: HealthReport): HealthReport {
  return {
    status: report.status,
    checks: Object.fromEntries(Object.entries(report.checks).map(([name, { status, latencyMs }]) => [name, { status, latencyMs }])),
  };
}

/** Postgres answers a query. */
export function databaseCheck(sql: postgres.Sql): HealthCheck {
  return { name: 'database', run: async () => void (await sql`select 1`) };
}

/** The job queue's tables are reachable and the extraction queue exists. */
export function queueCheck(boss: PgBoss): HealthCheck {
  return {
    name: 'queue',
    run: async () => {
      if (!(await boss.getQueue(EXTRACTION_QUEUE))) throw new Error(`Queue "${EXTRACTION_QUEUE}" is missing`);
    },
  };
}

/** (Worker only) This process's extraction job loop is running. */
export function workerLoopCheck(boss: PgBoss): HealthCheck {
  return {
    name: 'worker',
    run: async () => {
      const active = boss.getWipData().filter((worker) => worker.name === EXTRACTION_QUEUE && worker.state === 'active');
      if (active.length === 0) throw new Error('No extraction workers are running in this process');
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
