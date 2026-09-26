/**
 * The activity log's contract: event types, levels and the GET /api/logs response. Zod-free, so
 * the web app can import it (its query schema lives in requests.ts).
 *
 * An event is one thing that happened — an upload arriving, an extraction attempt finishing, a
 * worker starting — written by the API or the worker to the `events` table.
 */

/** GET /api/logs?type=…&type=…&upload=…&cursor=…&limit=… — newest first, one page at a time. */
export const LOG_EVENTS_PATH = '/api/logs';

export type LogLevel = 'info' | 'warn' | 'error';

/** How long events are kept. The Logs page is for recent history; the processes' stdout logs cover the rest. */
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
  /** Structured details, e.g. `{ code, attempt, durationMs, fileName }`. */
  data: Record<string, unknown>;
}

/** GET /api/uploads/:id/history — everything that happened to one upload, oldest first. */
export interface UploadHistoryResponse {
  events: LogEvent[];
}

export interface ListLogsResponse {
  events: LogEvent[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}
