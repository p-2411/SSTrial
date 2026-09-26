import type { LabelExtraction } from './extraction.ts';
import type { LabelField } from './fields.ts';

/**
 * The activity log's contract: event types, levels and the GET /api/logs response. Zod-free, so
 * the web app can import it (its query schema lives in requests.ts; extraction.ts is imported for
 * types only).
 *
 * An event is one thing that happened — an upload arriving, an extraction attempt finishing, a
 * worker starting — written by the API or the worker to the `events` table.
 */

/** GET /api/logs?q=…&type=…&type=…&upload=…&from=…&to=…&cursor=…&limit=… — newest first, one page at a time. */
export const LOG_EVENTS_PATH = '/api/logs';

/** GET /api/logs/:id/details — one event's details (EventDetails), fetched when someone opens them. */
export function logEventDetailsPath(id: string): string {
  return `${LOG_EVENTS_PATH}/${encodeURIComponent(id)}/details`;
}

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * How long events are kept once nothing needs them: events about no upload (a process starting),
 * and an upload's events once it's been deleted this long. A product's history is kept for as long
 * as the product exists. The processes' stdout logs cover the rest.
 */
export const LOG_RETENTION_DAYS = 30;

/** Which process wrote the event. */
export type LogSource = 'api' | 'worker';

/**
 * Every kind of event: the label the Logs page shows for it, and its level. A type always has the
 * same level ("Extraction failed" is always an error), so filtering by level is filtering by type.
 * Types are dotted by area (upload, extraction, …) so related ones sort and read together.
 */
export const LOG_EVENT_TYPES = {
  // The API, as an upload arrives
  'upload.created': { label: 'Upload started', level: 'info' },
  'upload.duplicate': { label: 'Identical file already uploaded', level: 'info' },
  'upload.queued': { label: 'Queued for extraction', level: 'info' },
  'upload.rejected': { label: 'File rejected', level: 'warn' },
  'upload.discarded': { label: 'Unfinished upload discarded', level: 'info' },
  'upload.retry_requested': { label: 'Retry requested', level: 'info' },
  'upload.edited': { label: 'Extracted data reviewed', level: 'info' },
  'upload.reverted': { label: 'Data reverted', level: 'info' },
  'upload.submitted': { label: 'Submitted to Products', level: 'info' },
  'upload.deleted': { label: 'Upload deleted', level: 'info' },
  // The worker, extracting
  'extraction.started': { label: 'Extraction started', level: 'info' },
  'extraction.completed': { label: 'Extraction completed', level: 'info' },
  'extraction.retry_scheduled': { label: 'Retry scheduled', level: 'warn' },
  'extraction.failed': { label: 'Extraction failed', level: 'error' },
  'extraction.abandoned': { label: 'Extraction abandoned', level: 'error' },
  'ratelimit.paused': { label: 'AI requests paused', level: 'warn' },
  // Either process
  'process.started': { label: 'Process started', level: 'info' },
} as const satisfies Record<string, { label: string; level: LogLevel }>;

export type LogEventType = keyof typeof LOG_EVENT_TYPES;
export const LOG_EVENT_TYPE_IDS = Object.keys(LOG_EVENT_TYPES) as LogEventType[];

export function isLogEventType(value: string): value is LogEventType {
  return Object.hasOwn(LOG_EVENT_TYPES, value);
}

/**
 * Events whose upload no longer exists once they've happened (its row is deleted), so there's
 * nothing to open. Earlier events of the same upload may still point at it.
 */
export const UPLOAD_GONE_EVENT_TYPES: readonly LogEventType[] = ['upload.rejected', 'upload.discarded', 'upload.deleted'];

/** The events that change a product's data, each saving the new state as a version (`data.versionId`). */
export const DATA_CHANGE_EVENT_TYPES: readonly LogEventType[] = ['extraction.completed', 'upload.edited', 'upload.reverted'];

/** The types of event an upload's history can hold: all but the system's own. */
export const UPLOAD_EVENT_TYPE_IDS: readonly LogEventType[] = LOG_EVENT_TYPE_IDS.filter((type) => type !== 'process.started');

/**
 * An event as a list shows it. Its details are left out, and fetched only when someone opens them
 * (EventDetails): with a history of any length, most never are.
 */
export interface LogEvent {
  /** Also the pagination cursor. A string: the database counts in 64-bit integers. */
  id: string;
  occurredAt: string;
  source: LogSource;
  level: LogLevel;
  type: LogEventType;
  uploadId: string | null;
  /** One readable sentence, e.g. "Attempt 2 of 5 failed: The AI service is rate-limiting requests." */
  message: string;
  /** The file it's about, if any: still known once its upload is deleted. */
  fileName: string | null;
  /** Whether it has details to open. */
  hasDetails: boolean;
}

/** What a person changed in one field, before and after. Values are as stored then, so may be in an older shape. */
export interface FieldChange {
  field: LabelField;
  from: unknown;
  to: unknown;
}

/** GET /api/logs/:id/details, or GET /api/uploads/:id/history/:eventId — what opening an event shows. */
export type EventDetails =
  /** The data as the AI read it (an extraction completing): the JSON as it was saved then. */
  | { kind: 'reading'; result: LabelExtraction }
  /**
   * What a review or revert changed, field by field; the fields confirmed as they were (a review);
   * and the fields whose checks were undone (a revert, back to before they were checked).
   */
  | { kind: 'changes'; changes: FieldChange[]; checked: LabelField[]; unchecked: LabelField[] }
  /** Any other event's facts, e.g. `{ code, attempt, durationMs, fileName }`. */
  | { kind: 'facts'; facts: Record<string, unknown> }
  /** It refers to saved data that's no longer kept: its upload was deleted. */
  | { kind: 'gone' };

/** One entry in an upload's history: an event, and whether an admin can put the data back to it. */
export type UploadHistoryEntry = LogEvent & {
  /** The version "Revert" restores; null where the data didn't change, or can't go back. */
  revertTo: string | null;
};

/** GET /api/uploads/:id/history — what happened to one upload, newest first, one page at a time. */
export function uploadHistoryPath(uploadId: string): string {
  return `/api/uploads/${encodeURIComponent(uploadId)}/history`;
}

/** GET /api/uploads/:id/history/:eventId — one history entry's details, for anyone who can see the upload. */
export function uploadHistoryDetailsPath(uploadId: string, eventId: string): string {
  return `${uploadHistoryPath(uploadId)}/${encodeURIComponent(eventId)}`;
}

export interface UploadHistoryResponse {
  entries: UploadHistoryEntry[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}

export interface ListLogsResponse {
  events: LogEvent[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}
