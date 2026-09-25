import { useSearchParams } from 'react-router';
import { LOG_EVENT_TYPE_IDS, type LogEventType } from '@label-extractor/shared';
import { logFilterParams, type LogFilters } from '@/api/logs';

/**
 * The activity log's filters live in the URL (?type=extraction.failed&type=…&upload=…), so they
 * survive refreshes and can be shared. Values that aren't valid are dropped rather than sent to
 * the server.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NO_LOG_FILTERS: LogFilters = { types: [], upload: null };

export function readLogFilters(params: URLSearchParams): LogFilters {
  const upload = params.get('upload');
  return {
    types: inCatalogueOrder(params.getAll('type')),
    upload: upload !== null && UUID.test(upload) ? upload : null,
  };
}

/**
 * Known types only, once each, in the catalogue's order, so the same choice always makes the same
 * URL (and the same cached query) however it was ticked.
 */
export function inCatalogueOrder(types: readonly string[]): LogEventType[] {
  return LOG_EVENT_TYPE_IDS.filter((type) => types.includes(type));
}

/** The filters in the URL, and a function that changes some of them (a navigation, so Back undoes it). */
export function useLogFilters(): [LogFilters, (changes: Partial<LogFilters>) => void] {
  const [params, setParams] = useSearchParams();
  const filters = readLogFilters(params);
  return [filters, (changes) => setParams(logFilterParams({ ...filters, ...changes }))];
}
