import type { HealthReport, OpsStatusResponse } from '@label-extractor/shared';
import type { OpsSnapshot } from './store.ts';

/** Shapes the monitoring snapshot for GET /api/ops: ISO dates, derived rates. */
export function toOpsStatus(snapshot: OpsSnapshot, health: HealthReport): OpsStatusResponse {
  const { worker, queue, recent } = snapshot;
  const finished = recent.completed + recent.failed;
  return {
    health,
    worker: { lastSeenAt: worker.lastSeenAt?.toISOString() ?? null, healthy: worker.healthy },
    queue,
    last24h: {
      completed: recent.completed,
      failed: recent.failed,
      failureRate: finished === 0 ? null : recent.failed / finished,
      medianSecondsToResult: roundOrNull(recent.medianSecondsToResult),
    },
  };
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}
