import type postgres from 'postgres';
import {
  LOG_EVENT_TYPE_IDS,
  LOG_EVENT_TYPES,
  UPLOAD_GONE_EVENT_TYPES,
  type LogEventType,
  type LogLevel,
  type LogSource,
} from '@label-extractor/shared';
import type { Db } from '../infra/db.ts';
import type { Logger } from '../infra/logger.ts';
import { containsPattern } from '../infra/search.ts';

/**
 * The activity log: the `events` table (see its migration). Not to be confused with the processes'
 * own stdout logs (infra/logger.ts): this is the history people browse on the Logs page — what
 * happened to each upload and to the system — not debugging output.
 *
 * Writing is best-effort by design. Events are recorded after the change they describe, not in
 * its transaction, and a failed write is reported to stdout and swallowed: losing a log line is
 * acceptable, failing an upload because the log couldn't be written is not. The one exception is a
 * deletion (see TransactionalEventLog).
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

/**
 * Writing events in the transaction of the change they describe, for the one kind that must not be
 * lost: a deletion's, the only record left of what was deleted. They're saved with the change or not
 * at all, so a failed write fails the change.
 */
export interface TransactionalEventLog {
  recordIn(tx: Db, events: readonly NewLogEvent[]): Promise<void>;
}

/**
 * An event as a list reads it: without its data, which is only read when someone opens its details
 * (`find`), just enough to say whether there's anything to open.
 */
export interface LogEventSummary extends Omit<LogEventRecord, 'data'> {
  fileName: string | null;
  /** The version of its upload's data it saved, if it changed the data. */
  versionId: string | null;
  /** Whether its data says more than the file name. */
  hasFacts: boolean;
}

/** What a list of events is narrowed to. Every one is optional but `types` (empty: every type). */
export interface EventFilters {
  types: LogEventType[];
  /** Words in the message, ignoring case. */
  search?: string;
  /** At or after. */
  from?: Date;
  /** Before. */
  to?: Date;
}

/** Reading the activity log, for the API. */
export interface EventQueries {
  /**
   * One page of events, newest first, of the given types (every known type when `types` is empty:
   * rows of a type this version no longer has, say one since removed, are never returned).
   * `after` is the ID of the last event on the previous page (keyset pagination: stable while new
   * events arrive, and fast at any depth).
   */
  list(options: EventFilters & { uploadId?: string; limit: number; after?: string }): Promise<LogEventSummary[]>;
  /** One event, data and all, if it exists and is of a known type. */
  find(id: string): Promise<LogEventRecord | null>;
}

/** Keeping the table to a bounded size, for the worker's once-a-minute housekeeping. */
export interface EventRetention {
  /**
   * Deletes what's no longer needed, `days` on: events about no upload once they're that old, and
   * all of an upload's once it's been deleted that long. A product's history stays while it exists.
   * Returns how many went.
   */
  pruneOlderThan(days: number): Promise<number>;
}

export type EventStore = EventLog & TransactionalEventLog & EventQueries & EventRetention;

export function createEventStore(sql: postgres.Sql, options: { source: LogSource; logger: Logger }): EventStore {
  const { source, logger } = options;

  /** Writes events, however many, in one statement. */
  async function insert(db: Db, events: readonly NewLogEvent[]) {
    await db`
      insert into events (source, level, type, upload_id, message, data)
      select ${source}, level, type, upload_id, message, data::jsonb
      from unnest(
        ${events.map((event) => LOG_EVENT_TYPES[event.type].level)}::text[],
        ${events.map((event) => event.type)}::text[],
        ${events.map((event) => event.uploadId ?? null)}::uuid[],
        ${events.map((event) => event.message)}::text[],
        ${events.map((event) => JSON.stringify(event.data ?? {}))}::text[]
      ) as event (level, type, upload_id, message, data)`;
  }

  return {
    async record(event) {
      try {
        await insert(sql, [event]);
      } catch (err) {
        logger.warn({ err, event: event.type, uploadId: event.uploadId }, 'Could not write to the activity log');
      }
    },

    async recordIn(tx, events) {
      if (events.length > 0) await insert(tx, events);
    },

    async list({ types, search, from, to, uploadId, limit, after }) {
      const rows = await sql`
        select id, occurred_at, source, type, upload_id, message,
               data->>'fileName' as file_name, data->>'versionId' as version_id,
               (data - 'fileName') <> '{}'::jsonb as has_facts
        from events
        where true
          and type = any(${types.length > 0 ? types : LOG_EVENT_TYPE_IDS}::text[])
          -- Through a trigram index (events_message_search), so any depth of history stays quick.
          ${search ? sql`and message ilike ${containsPattern(search)}` : sql``}
          ${uploadId ? sql`and upload_id = ${uploadId}` : sql``}
          ${from ? sql`and occurred_at >= ${from}` : sql``}
          ${to ? sql`and occurred_at < ${to}` : sql``}
          ${after ? sql`and id < ${after}::bigint` : sql``}
        order by id desc
        limit ${limit}`;
      return rows.map((row) => ({
        ...toRecordWithoutData(row),
        fileName: row.file_name ?? null,
        versionId: row.version_id ?? null,
        hasFacts: row.has_facts,
      }));
    },

    async find(id) {
      const [row] = await sql`select * from events where id = ${id}::bigint and type = any(${LOG_EVENT_TYPE_IDS}::text[])`;
      return row ? { ...toRecordWithoutData(row), data: row.data ?? {} } : null;
    },

    async pruneOlderThan(days) {
      const cutoff = () => sql`now() - make_interval(days => ${days})`;
      const system = await sql`delete from events where upload_id is null and occurred_at < ${cutoff()}`;
      // An upload's events all go together, once its "deleted" (or "rejected", "discarded") event is
      // old enough: that event goes too, so each deleted upload is looked at only until then.
      const deleted = await sql`
        delete from events
        where upload_id in (
          select upload_id from events
          where type = any(${UPLOAD_GONE_EVENT_TYPES}::text[]) and occurred_at < ${cutoff()})`;
      return system.count + deleted.count;
    },
  };
}

function toRecordWithoutData(row: postgres.Row): Omit<LogEventRecord, 'data'> {
  return {
    id: String(row.id),
    occurredAt: row.occurred_at,
    source: row.source,
    // Only known types are read, and a type's level is fixed (see LOG_EVENT_TYPES).
    type: row.type,
    level: LOG_EVENT_TYPES[row.type as LogEventType].level,
    uploadId: row.upload_id ?? null,
    message: row.message,
  };
}
