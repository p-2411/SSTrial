import { useSearchParams } from 'react-router';
import { isLogEventType, LOG_LEVEL_FILTER_IDS } from '@label-extractor/shared';
import { logFilterParams, type LogFilters } from '@/api/logs';

/**
 * The activity log's filters live in the URL (?level=warn&type=extraction.failed&upload=…), so they
 * survive refreshes, can be shared, and other pages can link to a filtered log (uploadLogsPath).
 * Values that aren't valid are dropped rather than sent to the server.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NO_LOG_FILTERS: LogFilters = { level: 'all', type: null, upload: null };

export function readLogFilters(params: URLSearchParams): LogFilters {
  const level = params.get('level');
  const type = params.get('type');
  const upload = params.get('upload');
  return {
    level: LOG_LEVEL_FILTER_IDS.find((id) => id === level) ?? 'all',
    type: type !== null && isLogEventType(type) ? type : null,
    upload: upload !== null && UUID.test(upload) ? upload : null,
  };
}

/** The filters in the URL, and a function that changes some of them (a navigation, so Back undoes it). */
export function useLogFilters(): [LogFilters, (changes: Partial<LogFilters>) => void] {
  const [params, setParams] = useSearchParams();
  const filters = readLogFilters(params);
  return [filters, (changes) => setParams(logFilterParams({ ...filters, ...changes }))];
}
