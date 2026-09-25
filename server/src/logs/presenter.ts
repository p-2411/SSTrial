import type { LogEvent } from '@label-extractor/shared';
import type { LogEventRecord } from './store.ts';

/** An event as GET /api/logs returns it: dates as ISO strings. */
export function toLogEvent(record: LogEventRecord): LogEvent {
  return { ...record, occurredAt: record.occurredAt.toISOString() };
}
