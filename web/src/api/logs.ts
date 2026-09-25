import { LOG_EVENTS_PATH, type ListLogsResponse, type LogEventType, type LogLevelFilter } from '@label-extractor/shared';
import { apiRequest } from './client.ts';

/** What the activity log is narrowed to: a minimum level, one type of event, one upload. */
export interface LogFilters {
  level: LogLevelFilter;
  type: LogEventType | null;
  upload: string | null;
}

/** The filters as query parameters, leaving out the defaults. The Logs page's URL uses the same ones. */
export function logFilterParams({ level, type, upload }: LogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (level !== 'all') params.set('level', level);
  if (type) params.set('type', type);
  if (upload) params.set('upload', upload);
  return params;
}

/** One page of the activity log, newest first, filtered by the server. */
export function listLogs(filters: LogFilters, cursor?: string): Promise<ListLogsResponse> {
  const params = logFilterParams(filters);
  if (cursor) params.set('cursor', cursor);
  const query = params.size > 0 ? `?${params}` : '';
  return apiRequest<ListLogsResponse>(`${LOG_EVENTS_PATH}${query}`);
}
