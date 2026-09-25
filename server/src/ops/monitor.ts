import type { Logger } from '../infra/logger.ts';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import { RETRY_POLICY } from '../extraction/retry-policy.ts';
import type { FiringAlert, MonitorSignals, OpsStore } from './store.ts';

/**
 * The monitor runs every minute in the worker (a pg-boss cron job, so once per minute however many
 * workers there are). It records a heartbeat, evaluates the alert rules, and keeps the alert log
 * up to date: an alert opens when its rule starts firing and resolves when it stops. Only opening
 * and resolving are logged, so a long incident is one log line, not one a minute.
 */

/** Tuned for this app's scale; see DECISIONS.md. */
export const MONITOR_RULES = {
  windowMinutes: 15,
  /** An upload waiting longer than this means workers are down or badly behind. */
  stalledAfterSeconds: 10 * 60,
  backlogSize: 500,
  /** Several times longer than a single attempt can run before it's presumed dead. */
  stuckAfterMinutes: Math.ceil((3 * RETRY_POLICY.attemptTimeoutSeconds) / 60),
  failureRate: 0.25,
  /** Too few results to judge a failure rate below this. */
  failureRateMinimumSample: 4,
} as const;

export function evaluateRules(signals: MonitorSignals): FiringAlert[] {
  const rules = MONITOR_RULES;
  const alerts: FiringAlert[] = [];
  const minutes = (seconds: number) => Math.round(seconds / 60);

  if (signals.recentConfigFailures > 0) {
    alerts.push({
      key: 'llm-config',
      severity: 'critical',
      title: 'AI service is refusing every request',
      message: `${signals.recentConfigFailures} upload(s) failed in the last ${rules.windowMinutes} minutes because of the API key, model access or billing. Every upload will fail until it's fixed.`,
    });
  }
  if (signals.oldestWaitingSeconds !== null && signals.oldestWaitingSeconds > rules.stalledAfterSeconds) {
    alerts.push({
      key: 'queue-stalled',
      severity: 'critical',
      title: 'Uploads are not being processed',
      message: `The oldest waiting upload has waited ${minutes(signals.oldestWaitingSeconds)} minutes. Workers may be down or far behind.`,
    });
  }
  if (signals.waiting > rules.backlogSize) {
    alerts.push({
      key: 'queue-backlog',
      severity: 'warning',
      title: 'Large backlog',
      message: `${signals.waiting} uploads are waiting. Consider adding workers (within the AI service's rate limit).`,
    });
  }
  if (signals.stuckProcessing > 0) {
    alerts.push({
      key: 'processing-stuck',
      severity: 'warning',
      title: 'Uploads stuck in processing',
      message: `${signals.stuckProcessing} upload(s) have been processing for over ${rules.stuckAfterMinutes} minutes.`,
    });
  }
  const finished = signals.recentCompleted + signals.recentFailed;
  if (finished >= rules.failureRateMinimumSample && signals.recentFailed / finished >= rules.failureRate) {
    alerts.push({
      key: 'failure-rate',
      severity: 'warning',
      title: 'High failure rate',
      message: `${signals.recentFailed} of ${finished} uploads failed in the last ${rules.windowMinutes} minutes (${Math.round((signals.recentFailed / finished) * 100)}%).`,
    });
  }
  if (signals.recentProcessingTimeouts > 0) {
    alerts.push({
      key: 'processing-timeouts',
      severity: 'warning',
      title: 'Workers crashed or hung mid-job',
      message: `${signals.recentProcessingTimeouts} upload(s) in the last ${rules.windowMinutes} minutes failed because every attempt stopped before finishing.`,
    });
  }
  return alerts;
}

export async function runMonitor(deps: { ops: OpsStore; events: EventLog; logger: Logger }): Promise<FiringAlert[]> {
  const { ops, events, logger } = deps;
  await ops.recordWorkerHeartbeat();

  const firing = evaluateRules(await ops.signals(MONITOR_RULES.windowMinutes, MONITOR_RULES.stuckAfterMinutes));
  for (const alert of firing) {
    if (await ops.raiseAlert(alert)) {
      // A structured `alert` field makes these easy to find or match in any log tool.
      logger.error({ alert: alert.key, severity: alert.severity }, `ALERT: ${alert.title}. ${alert.message}`);
      await events.record(logEvents.alertOpened(alert));
    }
  }
  for (const resolved of await ops.resolveAlertsExcept(firing.map((alert) => alert.key))) {
    logger.info({ alert: resolved.key }, 'Alert resolved');
    await events.record(logEvents.alertResolved(resolved));
  }
  return firing;
}
