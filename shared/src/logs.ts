/**
 * The activity log's contract: event types, levels and the GET /api/logs response. Zod-free, so
 * the web app can import it (its query schema lives in requests.ts).
 *
 * An event is one thing that happened — an upload arriving, an extraction attempt finishing, an
 * alert opening — written by the API or the worker to the `events` table.
 */

/** GET /api/logs?level=…&type=…&upload=…&cursor=…&limit=… — newest first, one page at a time. */
export const LOG_EVENTS_PATH = '/api/logs';

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Which process wrote the event. */
export type LogSource = 'api' | 'worker';

/**
 * Every kind of event, with the label the Logs page shows for it. Types are dotted by area
 * (upload, extraction, …) so related ones sort and read together.
 */
export const LOG_EVENT_TYPES = {
  // The API, as an upload arrives
  'upload.created': 'Upload started',
  'upload.duplicate': 'Identical file already uploaded',
  'upload.queued': 'Queued for extraction',
  'upload.rejected': 'File rejected',
  'upload.discarded': 'Unfinished upload discarded',
  'upload.retry_requested': 'Retry requested',
  // The worker, extracting
  'extraction.started': 'Extraction started',
  'extraction.completed': 'Extraction completed',
  'extraction.retry_scheduled': 'Retry scheduled',
  'extraction.failed': 'Extraction failed',
  'extraction.abandoned': 'Extraction abandoned',
  'ratelimit.paused': 'AI requests paused',
  // The worker's once-a-minute monitor
  'alert.opened': 'Alert opened',
  'alert.resolved': 'Alert resolved',
  // Either process
  'process.started': 'Process started',
} as const satisfies Record<string, string>;

export type LogEventType = keyof typeof LOG_EVENT_TYPES;
export const LOG_EVENT_TYPE_IDS = Object.keys(LOG_EVENT_TYPES) as LogEventType[];

export function isLogEventType(value: string): value is LogEventType {
  return Object.hasOwn(LOG_EVENT_TYPES, value);
}

/**
 * Events whose upload no longer exists once they've happened (its row is deleted), so there's
 * nothing to open. Earlier events of the same upload may still point at it.
 */
export const UPLOAD_GONE_EVENT_TYPES: readonly LogEventType[] = ['upload.rejected', 'upload.discarded'];

/** The page's level filter — everything, or a minimum level — with its label. */
export const LOG_LEVEL_FILTERS = {
  all: 'Everything',
  warn: 'Warnings and errors',
  error: 'Errors only',
} as const satisfies Record<string, string>;

export type LogLevelFilter = keyof typeof LOG_LEVEL_FILTERS;
export const LOG_LEVEL_FILTER_IDS = Object.keys(LOG_LEVEL_FILTERS) as LogLevelFilter[];

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

export interface ListLogsResponse {
  events: LogEvent[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}
