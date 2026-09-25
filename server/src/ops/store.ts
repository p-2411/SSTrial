import type postgres from 'postgres';
import { storedErrorCode, type AlertSeverity, type UploadErrorCode } from '@label-extractor/shared';

/** The numbers the alert rules look at. All come from the uploads table, so they cover every worker. */
export interface MonitorSignals {
  waiting: number;
  oldestWaitingSeconds: number | null;
  /** Uploads that have been `processing` for longer than any single attempt can take. */
  stuckProcessing: number;
  /** Uploads finished in the recent window. */
  recentCompleted: number;
  recentFailed: number;
  /** Failures that mean every job will fail until someone fixes config or billing. */
  recentConfigFailures: number;
  /** Uploads failed by the dead-letter handler: every attempt crashed or hung. */
  recentProcessingTimeouts: number;
}

/** Failures that no retry can fix: the API key, model access or billing needs attention. */
export const CONFIG_FAILURE_CODES = ['LLM_MISCONFIGURED', 'LLM_QUOTA_EXCEEDED'] as const satisfies readonly UploadErrorCode[];

export interface FiringAlert {
  key: string;
  severity: AlertSeverity;
  title: string;
  message: string;
}

export interface AlertRecord extends FiringAlert {
  id: number;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

/** Everything the System status page shows, as stored. ops/presenter.ts shapes it for the API. */
export interface OpsSnapshot {
  worker: { lastSeenAt: Date | null; healthy: boolean };
  queue: { waiting: number; retrying: number; processing: number; oldestWaitingSeconds: number | null };
  /** Over the last STATUS_WINDOW_HOURS. */
  recent: { completed: number; failed: number; medianSecondsToResult: number | null };
  failures: Array<{ code: UploadErrorCode; count: number }>;
  alerts: { open: AlertRecord[]; recent: AlertRecord[] };
}

export interface OpsStore {
  signals(windowMinutes: number, stuckAfterMinutes: number): Promise<MonitorSignals>;
  /** Opens an alert for `key`, or updates the open one. Returns true if it was newly opened. */
  raiseAlert(alert: FiringAlert): Promise<boolean>;
  /** Resolves open alerts whose rules are no longer firing. Returns the alerts it resolved. */
  resolveAlertsExcept(firingKeys: string[]): Promise<Array<{ key: string; title: string }>>;
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
    async signals(windowMinutes, stuckAfterMinutes) {
      const window = sql`now() - make_interval(mins => ${windowMinutes})`;
      const [row] = await sql`
        select
          count(*) filter (where status = 'queued')::int as waiting,
          extract(epoch from now() - min(updated_at) filter (where status = 'queued'))::float8 as oldest_waiting_seconds,
          count(*) filter (where status = 'processing' and updated_at < now() - make_interval(mins => ${stuckAfterMinutes}))::int as stuck_processing,
          count(*) filter (where status = 'completed' and completed_at > ${window})::int as recent_completed,
          count(*) filter (where status = 'failed' and updated_at > ${window})::int as recent_failed,
          count(*) filter (where status = 'failed' and updated_at > ${window}
                            and error_code = any(${CONFIG_FAILURE_CODES}))::int as recent_config_failures,
          count(*) filter (where status = 'failed' and updated_at > ${window}
                            and error_code = ${'PROCESSING_TIMEOUT' satisfies UploadErrorCode})::int as recent_processing_timeouts
        from uploads`;
      return {
        waiting: row!.waiting,
        oldestWaitingSeconds: row!.oldest_waiting_seconds,
        stuckProcessing: row!.stuck_processing,
        recentCompleted: row!.recent_completed,
        recentFailed: row!.recent_failed,
        recentConfigFailures: row!.recent_config_failures,
        recentProcessingTimeouts: row!.recent_processing_timeouts,
      };
    },

    async raiseAlert(alert) {
      // Update the open alert if there is one; otherwise open a new one. (The partial unique index
      // allows only one open alert per key.)
      const updated = await sql`
        update ops_alerts
        set severity = ${alert.severity}, title = ${alert.title}, message = ${alert.message},
            occurrences = occurrences + 1, last_seen_at = now()
        where key = ${alert.key} and resolved_at is null
        returning id`;
      if (updated.length > 0) return false;
      await sql`
        insert into ops_alerts (key, severity, title, message)
        values (${alert.key}, ${alert.severity}, ${alert.title}, ${alert.message})
        on conflict do nothing`;
      return true;
    },

    async resolveAlertsExcept(firingKeys) {
      const rows = await sql`
        update ops_alerts set resolved_at = now()
        where resolved_at is null and not (key = any(${firingKeys}::text[]))
        returning key, title`;
      return rows.map((row) => ({ key: row.key as string, title: row.title as string }));
    },

    async recordWorkerHeartbeat() {
      await sql`
        insert into ops_heartbeats (process) values (${WORKER})
        on conflict (process) do update set last_seen_at = now()`;
    },

    async snapshot() {
      const window = sql`now() - make_interval(hours => ${STATUS_WINDOW_HOURS})`;
      const [queue] = await sql`
        select
          count(*) filter (where status = 'queued')::int as waiting,
          count(*) filter (where status = 'queued' and error_code is not null)::int as retrying,
          count(*) filter (where status = 'processing')::int as processing,
          extract(epoch from now() - min(updated_at) filter (where status = 'queued'))::float8 as oldest_waiting_seconds
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
      const open = await sql`select * from ops_alerts where resolved_at is null order by first_seen_at desc`;
      const resolved = await sql`select * from ops_alerts where resolved_at is not null order by resolved_at desc limit 20`;
      const [heartbeat] = await sql`
        select last_seen_at, last_seen_at > now() - make_interval(secs => ${WORKER_SILENT_AFTER_SECONDS}) as healthy
        from ops_heartbeats where process = ${WORKER}`;

      return {
        worker: { lastSeenAt: heartbeat?.last_seen_at ?? null, healthy: heartbeat?.healthy ?? false },
        queue: {
          waiting: queue!.waiting,
          retrying: queue!.retrying,
          processing: queue!.processing,
          oldestWaitingSeconds: queue!.oldest_waiting_seconds,
        },
        recent: {
          completed: recent!.completed,
          failed: recent!.failed,
          medianSecondsToResult: recent!.median_seconds === null ? null : Number(recent!.median_seconds),
        },
        failures: failures.map((row) => ({ code: storedErrorCode(row.error_code), count: row.count })),
        alerts: { open: open.map(toAlert), recent: resolved.map(toAlert) },
      };
    },
  };
}

function toAlert(row: postgres.Row): AlertRecord {
  return {
    id: Number(row.id),
    key: row.key,
    severity: row.severity,
    title: row.title,
    message: row.message,
    occurrences: row.occurrences,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at ?? null,
  };
}
