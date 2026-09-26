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
import { apiRequest } from './client.ts';
import { searchAndDayParams, type SearchAndDays } from './filters.ts';

/**
 * What a list of events is narrowed to: words in their messages ('' means any), a span of days,
 * and some types of event (none means every type). The activity log and each upload's history
 * both take these.
 */
export interface ActivityFilters extends SearchAndDays {
  types: LogEventType[];
}

export const NO_ACTIVITY_FILTERS: ActivityFilters = { search: '', types: [], from: null, to: null };

/** The activity log's filters: the same, and one upload. */
export interface LogFilters extends ActivityFilters {
  upload: string | null;
}

/** The filters as the API takes them (one `type` per type), and the page to start from. */
function apiParams(filters: ActivityFilters & { upload?: string | null }, cursor: string | undefined): string {
  const params = searchAndDayParams(filters);
  for (const type of filters.types) params.append('type', type);
  if (filters.upload) params.set('upload', filters.upload);
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
