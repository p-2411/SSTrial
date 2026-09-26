import { LOG_EVENTS_PATH, type ListLogsResponse, type LogEvent, type LogEventType, type UploadHistoryResponse } from '@label-extractor/shared';
import { apiRequest } from './client.ts';

/** What the activity log is narrowed to: some types of event (none means every type), one upload. */
export interface LogFilters {
  types: LogEventType[];
  upload: string | null;
}

/** The filters as query parameters, one `type` per type. The Logs page's URL uses the same ones. */
export function logFilterParams({ types, upload }: LogFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const type of types) params.append('type', type);
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

/** Everything that happened to one upload, oldest first. Open to anyone who can see the upload. */
export async function getUploadHistory(id: string): Promise<LogEvent[]> {
  return (await apiRequest<UploadHistoryResponse>(`/api/uploads/${encodeURIComponent(id)}/history`)).events;
}
