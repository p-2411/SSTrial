import { describe, expect, it, vi } from 'vitest';
import { LOG_RETENTION_DAYS } from '@label-extractor/shared';
import { pruneActivityLog } from '../../src/worker/worker.ts';
import { InMemoryEventStore, silentLogger } from '../fakes.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('pruneActivityLog', () => {
  it(`deletes events older than ${LOG_RETENTION_DAYS} days and keeps the rest`, async () => {
    const events = new InMemoryEventStore();
    events.seed({ level: 'info', type: 'process.started', message: 'old', occurredAt: new Date(Date.now() - (LOG_RETENTION_DAYS + 1) * DAY_MS) });
    events.seed({ level: 'info', type: 'process.started', message: 'recent', occurredAt: new Date(Date.now() - DAY_MS) });

    await pruneActivityLog({ events, logger: silentLogger });

    expect(events.events.map((event) => event.message)).toEqual(['recent']);
  });

  it('reports a failure instead of throwing, so the monitor keeps running', async () => {
    const events = new InMemoryEventStore();
    events.pruneOlderThan = async () => {
      throw new Error('connection lost');
    };
    const logger = { ...silentLogger, warn: vi.fn() } as unknown as typeof silentLogger;

    await expect(pruneActivityLog({ events, logger })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
