import type postgres from 'postgres';
import { LOG_EVENT_TYPE_IDS, LOG_EVENT_TYPES, type LogEventType, type LogLevel, type LogSource } from '@label-extractor/shared';
import type { Logger } from '../infra/logger.ts';

/**
 * The activity log: the `events` table (see its migration). Not to be confused with the processes'
 * own stdout logs (infra/logger.ts): this is the history people browse on the Logs page — what
 * happened to each upload and to the system — not debugging output.
 *
 * Writing is best-effort by design. Events are recorded after the change they describe, never in
 * its transaction, and a failed write is reported to stdout and swallowed: losing a log line is
 * acceptable, failing an upload because the log couldn't be written is not.
 */

/**
 * An event as a caller describes it. The store adds its level (fixed per type, see
 * LOG_EVENT_TYPES), its source and the time.
 */
export interface NewLogEvent {
  type: LogEventType;
  message: string;
  uploadId?: string | null;
  data?: Record<string, unknown>;
}

export interface LogEventRecord {
  id: string;
  occurredAt: Date;
  source: LogSource;
  level: LogLevel;
  type: LogEventType;
  uploadId: string | null;
  message: string;
  data: Record<string, unknown>;
}

/** Writing to the activity log, for the use cases and the worker. */
export interface EventLog {
  /** Records an event. Never rejects: a failed write is logged to stdout instead (see above). */
  record(event: NewLogEvent): Promise<void>;
}

/** Reading the activity log, for the API. */
export interface EventQueries {
  /**
   * One page of events, newest first, of the given types (every known type when `types` is empty:
   * rows of a type this version no longer has, say one since removed, are never returned).
   * `after` is the ID of the last event on the previous page (keyset pagination: stable while new
   * events arrive, and fast at any depth).
   */
  list(options: { types: LogEventType[]; uploadId?: string; limit: number; after?: string }): Promise<LogEventRecord[]>;
}

/** Keeping the table to a bounded size, for the worker's once-a-minute housekeeping. */
export interface EventRetention {
  /** Deletes events older than `days`. Returns how many went. */
  pruneOlderThan(days: number): Promise<number>;
}

export type EventStore = EventLog & EventQueries & EventRetention;

export function createEventStore(sql: postgres.Sql, options: { source: LogSource; logger: Logger }): EventStore {
  const { source, logger } = options;

  return {
    async record(event) {
      try {
        await sql`
          insert into events (source, level, type, upload_id, message, data)
          values (${source}, ${LOG_EVENT_TYPES[event.type].level}, ${event.type}, ${event.uploadId ?? null}, ${event.message},
                  ${sql.json((event.data ?? {}) as postgres.JSONValue)})`;
      } catch (err) {
        logger.warn({ err, event: event.type, uploadId: event.uploadId }, 'Could not write to the activity log');
      }
    },

    async list({ types, uploadId, limit, after }) {
      const rows = await sql`
        select * from events
        where true
          and type = any(${types.length > 0 ? types : LOG_EVENT_TYPE_IDS}::text[])
          ${uploadId ? sql`and upload_id = ${uploadId}` : sql``}
          ${after ? sql`and id < ${after}::bigint` : sql``}
        order by id desc
        limit ${limit}`;
      return rows.map(toRecord);
    },

    async pruneOlderThan(days) {
      const result = await sql`delete from events where occurred_at < now() - make_interval(days => ${days})`;
      return result.count;
    },
  };
}

function toRecord(row: postgres.Row): LogEventRecord {
  return {
    id: String(row.id),
    occurredAt: row.occurred_at,
    source: row.source,
    // `list` only returns known types, and a type's level is fixed (see LOG_EVENT_TYPES).
    type: row.type,
    level: LOG_EVENT_TYPES[row.type as LogEventType].level,
    uploadId: row.upload_id ?? null,
    message: row.message,
    data: row.data ?? {},
  };
}
