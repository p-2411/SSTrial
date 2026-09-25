import type { UploadErrorCode } from './uploads.ts';

/** Contracts for GET /api/ops — the data behind the System status page. */

export interface HealthCheckResult {
  status: 'ok' | 'error';
  latencyMs: number;
  /** What went wrong, when status is 'error'. */
  error?: string;
}

/** GET /api/health (on both the API and the worker): 200 when every check passes, else 503. */
export interface HealthReport {
  status: 'ok' | 'unhealthy';
  checks: Record<string, HealthCheckResult>;
}

export type AlertSeverity = 'warning' | 'critical';

export interface OpsAlert {
  id: number;
  /** Which rule raised it, e.g. 'queue-stalled'. */
  key: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** How many monitor runs it has been seen in. */
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** `null` while the alert is still open. */
  resolvedAt: string | null;
}

export interface OpsStatusResponse {
  generatedAt: string;
  /** The API's own checks (database, queue). */
  health: HealthReport;
  /** Workers can't report being down, so this comes from their last heartbeat. */
  worker: { lastSeenAt: string | null; healthy: boolean };
  queue: {
    /** Uploads waiting for a worker, including ones waiting to retry. */
    waiting: number;
    /** Of those, how many are waiting to retry after a failed attempt. */
    retrying: number;
    processing: number;
    /** How long the longest-waiting upload has been waiting. */
    oldestWaitingSeconds: number | null;
  };
  last24h: {
    completed: number;
    failed: number;
    /** failed / (completed + failed), or `null` when nothing finished. */
    failureRate: number | null;
    /** Median time from upload to result, for uploads completed in the window. */
    medianSecondsToResult: number | null;
  };
  failuresByReason: Array<{ code: UploadErrorCode; message: string; count: number }>;
  alerts: { open: OpsAlert[]; recent: OpsAlert[] };
}
