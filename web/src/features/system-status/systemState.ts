import type { AlertSeverity, OpsStatusResponse } from '@label-extractor/shared';
import type { Tone } from '@/lib/tone';

/**
 * How the system is doing, worked out from GET /api/ops. Kept apart from the page (which is split
 * out of the main bundle) because the sidebar's alert dot needs it on every page.
 */

/** The most serious open alert's severity, or `null` when nothing is open. */
export function worstOpenSeverity(alerts: OpsStatusResponse['alerts']): AlertSeverity | null {
  if (alerts.open.some((alert) => alert.severity === 'critical')) return 'critical';
  return alerts.open.length > 0 ? 'warning' : null;
}

export type OverallState = 'ok' | 'degraded' | 'down';

/**
 * The page's headline: down when a health check fails, the worker has gone quiet or a critical
 * alert is open; degraded while any other alert is open; otherwise ok.
 */
export function overallState({ health, worker, alerts }: Pick<OpsStatusResponse, 'health' | 'worker' | 'alerts'>): OverallState {
  const worst = worstOpenSeverity(alerts);
  if (health.status !== 'ok' || !worker.healthy || worst === 'critical') return 'down';
  return worst === 'warning' ? 'degraded' : 'ok';
}

export const SEVERITY_TONE: Record<AlertSeverity, Tone> = { critical: 'danger', warning: 'warning' };
