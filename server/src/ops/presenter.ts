import {
  uploadErrorMessage,
  type HealthReport,
  type OpsAlert,
  type OpsStatusResponse,
  type UploadErrorCode,
} from '@label-extractor/shared';
import type { AlertRecord, OpsSnapshot } from './store.ts';

/** Shapes the monitoring snapshot for GET /api/ops: messages for codes, ISO dates, derived rates. */
export function toOpsStatus(snapshot: OpsSnapshot, health: HealthReport, now: Date): OpsStatusResponse {
  const { worker, queue, recent } = snapshot;
  const finished = recent.completed + recent.failed;
  return {
    generatedAt: now.toISOString(),
    health,
    worker: { lastSeenAt: worker.lastSeenAt?.toISOString() ?? null, healthy: worker.healthy },
    queue: { ...queue, oldestWaitingSeconds: roundOrNull(queue.oldestWaitingSeconds) },
    last24h: {
      completed: recent.completed,
      failed: recent.failed,
      failureRate: finished === 0 ? null : recent.failed / finished,
      medianSecondsToResult: roundOrNull(recent.medianSecondsToResult),
    },
    failuresByReason: mergeByCode(snapshot.failures).map(({ code, count }) => ({
      code,
      message: uploadErrorMessage(code),
      count,
    })),
    alerts: { open: snapshot.alerts.open.map(toOpsAlert), recent: snapshot.alerts.recent.map(toOpsAlert) },
  };
}

function toOpsAlert(alert: AlertRecord): OpsAlert {
  return {
    ...alert,
    firstSeenAt: alert.firstSeenAt.toISOString(),
    lastSeenAt: alert.lastSeenAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
  };
}

/** Codes no longer in the catalogue are read as INTERNAL_ERROR, so one code can appear twice. */
function mergeByCode(failures: OpsSnapshot['failures']): OpsSnapshot['failures'] {
  const counts = new Map<UploadErrorCode, number>();
  for (const { code, count } of failures) counts.set(code, (counts.get(code) ?? 0) + count);
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}
