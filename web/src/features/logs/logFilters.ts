import { useSearchParams } from 'react-router';
import type { NavigateOptions } from 'react-router';
import { logFilterParams, NO_ACTIVITY_FILTERS, type LogFilters } from '@/api/logs';
import { MAX_SEARCH_LENGTH } from '@/components/SearchInput';
import { isDay } from '@/lib/dayRange';
import { inCatalogueOrder } from '@/features/activity/eventTypes';

/**
 * The activity log's filters live in the URL (?q=oat+milk&type=extraction.failed&type=…&from=…
 * &to=…&upload=…), so they survive refreshes and can be shared. Values that aren't valid are
 * dropped rather than sent to the server.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NO_LOG_FILTERS: LogFilters = { ...NO_ACTIVITY_FILTERS, upload: null };

export function readLogFilters(params: URLSearchParams): LogFilters {
  const upload = params.get('upload');
  const day = (name: string) => {
    const value = params.get(name);
    return value !== null && isDay(value) ? value : null;
  };
  let [from, to] = [day('from'), day('to')];
  // Days written the wrong way round mean the days between them.
  if (from && to && from > to) [from, to] = [to, from];
  return {
    search: (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    types: inCatalogueOrder(params.getAll('type')),
    from,
    to,
    upload: upload !== null && UUID.test(upload) ? upload : null,
  };
}

/**
 * The filters in the URL, and a function that changes some of them: a navigation, so Back undoes
 * it (unless `replace`, as for a search being typed). Changes apply to the URL as it is then, so a
 * change made after a pause can't undo one made meanwhile.
 */
export function useLogFilters(): [LogFilters, (changes: Partial<LogFilters>, options?: NavigateOptions) => void] {
  const [params, setParams] = useSearchParams();
  return [
    readLogFilters(params),
    (changes, options) => setParams((current) => logFilterParams({ ...readLogFilters(current), ...changes }), options),
  ];
}
