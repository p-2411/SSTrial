import { describe, expect, it, vi } from 'vitest';
import { evaluateRules, runMonitor } from '../../src/ops/monitor.ts';
import type { FiringAlert, MonitorSignals, OpsStore } from '../../src/ops/store.ts';
import { silentLogger } from '../fakes.ts';

const quiet: MonitorSignals = {
  waiting: 0,
  oldestWaitingSeconds: null,
  stuckProcessing: 0,
  recentCompleted: 10,
  recentFailed: 0,
  recentConfigFailures: 0,
  recentProcessingTimeouts: 0,
};
const keys = (signals: Partial<MonitorSignals>) => evaluateRules({ ...quiet, ...signals }).map((alert) => alert.key);

describe('alert rules', () => {
  it('raise nothing when all is well', () => {
    expect(keys({})).toEqual([]);
  });

  it('flag a bad key, model or billing immediately, as critical', () => {
    const [alert] = evaluateRules({ ...quiet, recentConfigFailures: 1 });
    expect(alert).toMatchObject({ key: 'llm-config', severity: 'critical' });
  });

  it('flag a stalled queue once the oldest upload has waited over 10 minutes', () => {
    expect(keys({ oldestWaitingSeconds: 9 * 60 })).toEqual([]);
    expect(keys({ oldestWaitingSeconds: 14 * 60 })).toEqual(['queue-stalled']);
  });

  it('flag a large backlog', () => {
    expect(keys({ waiting: 501 })).toEqual(['queue-backlog']);
  });

  it('flag uploads stuck in processing', () => {
    expect(keys({ stuckProcessing: 2 })).toEqual(['processing-stuck']);
  });

  it('flag a high failure rate, but only with enough results to judge', () => {
    expect(keys({ recentCompleted: 1, recentFailed: 2 })).toEqual([]); // 3 results: too few
    expect(keys({ recentCompleted: 3, recentFailed: 2 })).toEqual(['failure-rate']); // 40%
    expect(keys({ recentCompleted: 9, recentFailed: 1 })).toEqual([]); // 10%
  });

  it('flag jobs that crashed or hung on every attempt', () => {
    expect(keys({ recentProcessingTimeouts: 1 })).toEqual(['processing-timeouts']);
  });
});

describe('runMonitor', () => {
  function fakeOps(signals: Partial<MonitorSignals>, alreadyOpen: string[] = []) {
    const open = new Set(alreadyOpen);
    const ops: OpsStore = {
      signals: async () => ({ ...quiet, ...signals }),
      raiseAlert: vi.fn(async (alert: FiringAlert) => !open.has(alert.key) && Boolean(open.add(alert.key))),
      resolveAlertsExcept: vi.fn(async (firing: string[]) => [...open].filter((key) => !firing.includes(key))),
      recordHeartbeat: vi.fn(async () => {}),
      status: vi.fn(),
    };
    return ops;
  }

  it('records a heartbeat, raises what fires and resolves what stopped', async () => {
    const ops = fakeOps({ waiting: 600 }, ['queue-stalled']);
    const logger = { ...silentLogger, error: vi.fn(), info: vi.fn() } as unknown as typeof silentLogger;

    const firing = await runMonitor({ ops, logger });

    expect(ops.recordHeartbeat).toHaveBeenCalledWith('worker');
    expect(firing.map((alert) => alert.key)).toEqual(['queue-backlog']);
    expect(ops.resolveAlertsExcept).toHaveBeenCalledWith(['queue-backlog']);
    expect(logger.error).toHaveBeenCalledTimes(1); // opened once
  });

  it('logs an alert only when it opens, not on every run it keeps firing', async () => {
    const ops = fakeOps({ waiting: 600 }, ['queue-backlog']);
    const logger = { ...silentLogger, error: vi.fn(), info: vi.fn() } as unknown as typeof silentLogger;

    await runMonitor({ ops, logger });

    expect(logger.error).not.toHaveBeenCalled();
  });
});
