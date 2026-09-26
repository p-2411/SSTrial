/** Contracts for GET /api/ops — the data behind the System page's status. */

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

export interface OpsStatusResponse {
  /** The API's own checks (database, queue). */
  health: HealthReport;
  /** Workers can't report being down, so this comes from their last heartbeat. */
  worker: { lastSeenAt: string | null; healthy: boolean };
  queue: {
    /** Uploads waiting for their first attempt. */
    waiting: number;
    /** Uploads waiting to try again after a failed attempt. */
    retrying: number;
    processing: number;
  };
  last24h: {
    completed: number;
    failed: number;
    /** failed / (completed + failed), or `null` when nothing finished. */
    failureRate: number | null;
    /** Median time from upload to result, for uploads completed in the window. */
    medianSecondsToResult: number | null;
  };
}
