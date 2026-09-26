import type postgres from 'postgres';
import { PgBoss, type ConstructorOptions } from 'pg-boss';
import type { Db } from './db.ts';
import type { Logger } from './logger.ts';

/**
 * The job queue: pg-boss on the same Postgres database as our data.
 *
 * pg-boss stores jobs in its own `pgboss` schema and hands them to workers with
 * `SELECT … FOR UPDATE SKIP LOCKED`, so any number of worker processes can pull from one queue
 * without double-processing. Because the queue lives in our database, a job can be created in the
 * same transaction as the row update that justifies it — they commit or roll back together.
 *
 * This module only connects. The queues are defined where they're used: uploads/jobs.ts for the
 * upload queues, worker/worker.ts for the once-a-minute housekeeping.
 */

export interface StartQueueOptions {
  connectionString: string;
  /** Which process is connecting. Only workers run pg-boss's background maintenance. */
  role: 'api' | 'worker';
  logger: Logger;
  /** Extra pg-boss settings. Integration tests use a separate schema and faster supervision. */
  overrides?: Partial<ConstructorOptions>;
}

export async function startQueue(options: StartQueueOptions): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    application_name: `label-extractor-${options.role}`,
    // pg-boss's own connection pool. Kept small: Supabase's free tier caps connections.
    max: 3,
    // Maintenance (expiring stuck jobs, deleting old ones) and cron schedules only need to run
    // somewhere: in the workers. The API is purely a producer.
    supervise: options.role === 'worker',
    schedule: options.role === 'worker',
    ...options.overrides,
  });

  // pg-boss emits errors from its background loops; unhandled, they'd crash the process.
  boss.on('error', (err) => options.logger.error({ err }, 'Queue error'));

  await boss.start();
  return boss;
}

/**
 * Adapts a postgres.js transaction to the minimal interface pg-boss uses to run SQL, so a job can
 * be enqueued *inside* the same transaction as our own writes (see uploads/store.ts).
 */
export function asPgBossDb(tx: Db) {
  return {
    async executeSql(text: string, values: unknown[] = []) {
      const rows = await tx.unsafe(text, values as postgres.ParameterOrJSON<never>[]);
      return { rows: [...rows] };
    },
  };
}
