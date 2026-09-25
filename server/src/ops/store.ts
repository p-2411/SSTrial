import type postgres from 'postgres';
import { storedErrorCode, type UploadErrorCode } from '@label-extractor/shared';

/** Everything the System status page shows, as stored. ops/presenter.ts shapes it for the API. */
export interface OpsSnapshot {
  worker: { lastSeenAt: Date | null; healthy: boolean };
  queue: { waiting: number; retrying: number; processing: number };
  /** Over the last STATUS_WINDOW_HOURS. */
  recent: { completed: number; failed: number; medianSecondsToResult: number | null };
  failures: Array<{ code: UploadErrorCode; count: number }>;
}

export interface OpsStore {
  /** Records that a worker is running. The monitor calls it every minute. */
  recordWorkerHeartbeat(): Promise<void>;
  snapshot(): Promise<OpsSnapshot>;
}

/** A worker that hasn't checked in for this long is treated as down. */
const WORKER_SILENT_AFTER_SECONDS = 180;
/** The System status page's throughput and failure figures cover this window (`last24h`). */
const STATUS_WINDOW_HOURS = 24;
/** Heartbeats are keyed by process type; only workers send them (the API answers health checks). */
const WORKER = 'worker';

export function createOpsStore(sql: postgres.Sql): OpsStore {
  return {
    async recordWorkerHeartbeat() {
      await sql`
        insert into ops_heartbeats (process) values (${WORKER})
        on conflict (process) do update set last_seen_at = now()`;
    },

    async snapshot() {
      const window = sql`now() - make_interval(hours => ${STATUS_WINDOW_HOURS})`;
      const [queue] = await sql`
        select
          count(*) filter (where status = 'queued' and error_code is null)::int as waiting,
          count(*) filter (where status = 'queued' and error_code is not null)::int as retrying,
          count(*) filter (where status = 'processing')::int as processing
        from uploads`;
      const [recent] = await sql`
        select
          count(*) filter (where status = 'completed' and completed_at > ${window})::int as completed,
          count(*) filter (where status = 'failed' and updated_at > ${window})::int as failed,
          percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at))
            filter (where status = 'completed' and completed_at > ${window}) as median_seconds
        from uploads`;
      const failures = await sql`
        select error_code, count(*)::int as count from uploads
        where status = 'failed' and updated_at > ${window}
        group by error_code order by count desc`;
      const [heartbeat] = await sql`
        select last_seen_at, last_seen_at > now() - make_interval(secs => ${WORKER_SILENT_AFTER_SECONDS}) as healthy
        from ops_heartbeats where process = ${WORKER}`;

      return {
        worker: { lastSeenAt: heartbeat?.last_seen_at ?? null, healthy: heartbeat?.healthy ?? false },
        queue: { waiting: queue!.waiting, retrying: queue!.retrying, processing: queue!.processing },
        recent: {
          completed: recent!.completed,
          failed: recent!.failed,
          medianSecondsToResult: recent!.median_seconds === null ? null : Number(recent!.median_seconds),
        },
        failures: failures.map((row) => ({ code: storedErrorCode(row.error_code), count: row.count })),
      };
    },
  };
}
