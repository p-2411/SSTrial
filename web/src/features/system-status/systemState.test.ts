import { describe, expect, it } from 'vitest';
import type { AlertSeverity, OpsAlert, OpsStatusResponse } from '@label-extractor/shared';
import { overallState, worstOpenSeverity } from './systemState';

const alert = (severity: AlertSeverity): OpsAlert => ({
  id: 1,
  key: 'queue-stalled',
  severity,
  title: 'Uploads are not being processed',
  message: 'Waited 14 minutes.',
  occurrences: 1,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
});

const healthy: Pick<OpsStatusResponse, 'health' | 'worker' | 'alerts'> = {
  health: { status: 'ok', checks: { database: { status: 'ok', latencyMs: 3 } } },
  worker: { lastSeenAt: '2026-01-01T00:00:00.000Z', healthy: true },
  alerts: { open: [], recent: [alert('critical')] },
};

describe('worstOpenSeverity', () => {
  it('is critical if any open alert is, ignoring resolved ones', () => {
    expect(worstOpenSeverity({ open: [], recent: [alert('critical')] })).toBeNull();
    expect(worstOpenSeverity({ open: [alert('warning')], recent: [] })).toBe('warning');
    expect(worstOpenSeverity({ open: [alert('warning'), alert('critical')], recent: [] })).toBe('critical');
  });
});

describe('overallState', () => {
  it('is ok when every check passes, the worker reports and nothing is open', () => {
    expect(overallState(healthy)).toBe('ok');
  });

  it('needs attention while a warning is open', () => {
    expect(overallState({ ...healthy, alerts: { open: [alert('warning')], recent: [] } })).toBe('degraded');
  });

  it('is down for a failed check, a quiet worker or a critical alert, whatever else is fine', () => {
    expect(overallState({ ...healthy, health: { status: 'unhealthy', checks: {} } })).toBe('down');
    expect(overallState({ ...healthy, worker: { lastSeenAt: null, healthy: false } })).toBe('down');
    expect(overallState({ ...healthy, alerts: { open: [alert('critical')], recent: [] } })).toBe('down');
  });
});
