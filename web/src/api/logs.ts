import {
  LOG_EVENTS_PATH,
  logEventDetailsPath,
  uploadHistoryDetailsPath,
  uploadHistoryPath,
  type EventDetails,
  type ListLogsResponse,
  type LogEventType,
  type UploadHistoryResponse,
} from '@label-extractor/shared';
import { toInstants, type DayRange } from '@/lib/dayRange';
import { apiRequest } from './client.ts';

/**
 * What a list of events is narrowed to: words in their messages ('' means any), some types of
 * event (none means every type), and a span of days (see DayRange). The activity log and each
 * upload's history both take these.
 */
export interface ActivityFilters extends DayRange {
  search: string;
  types: LogEventType[];
}

export const NO_ACTIVITY_FILTERS: ActivityFilters = { search: '', types: [], from: null, to: null };

/** The activity log's filters: the same, and one upload. */
export interface LogFilters extends ActivityFilters {
  upload: string | null;
}

export function isFiltered(filters: ActivityFilters): boolean {
  return filters.search !== '' || filters.types.length > 0 || filters.from !== null || filters.to !== null;
}

/**
 * The filters as query parameters, one `type` per type, days as days. The Logs page's URL uses
 * these; requests to the API send the days as instants instead (see `apiParams`).
 */
export function logFilterParams({ search, types, from, to, upload }: LogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  for (const type of types) params.append('type', type);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (upload) params.set('upload', upload);
  return params;
}

/** The filters as the API takes them: the days as the viewer's own midnights. */
function apiParams(filters: ActivityFilters & { upload?: string | null }, cursor: string | undefined): string {
  const params = logFilterParams({ upload: null, ...filters, from: null, to: null });
  const { from, to } = toInstants(filters);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (cursor) params.set('cursor', cursor);
  return params.size > 0 ? `?${params}` : '';
}

/** One page of the activity log, newest first, filtered by the server. */
export function listLogs(filters: LogFilters, cursor?: string): Promise<ListLogsResponse> {
  return apiRequest<ListLogsResponse>(`${LOG_EVENTS_PATH}${apiParams(filters, cursor)}`);
}

/**
 * One page of an upload's history, newest first, each entry saying whether its data can be
 * reverted to. Open to anyone who can see the upload (reverting is for admins).
 */
export function getUploadHistory(uploadId: string, filters: ActivityFilters, cursor?: string): Promise<UploadHistoryResponse> {
  return apiRequest<UploadHistoryResponse>(`${uploadHistoryPath(uploadId)}${apiParams(filters, cursor)}`);
}

/**
 * What opening an event shows. From the activity log (admins), or, for anyone who can see the
 * upload, from its history.
 */
export function getEventDetails(source: EventDetailsSource, eventId: string): Promise<EventDetails> {
  return apiRequest<EventDetails>(source.uploadId ? uploadHistoryDetailsPath(source.uploadId, eventId) : logEventDetailsPath(eventId));
}

/** Where an event was opened: the activity log, or an upload's history. */
export type EventDetailsSource = { uploadId: string } | { uploadId?: undefined };
