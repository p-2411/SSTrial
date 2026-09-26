import { toInstants, type DayRange } from '@/lib/dayRange';

/**
 * What every list's filter has: words to search for ('' for any) and a span of days (see
 * DayRange). Products, the activity log and each upload's history all narrow by these.
 */
export interface SearchAndDays extends DayRange {
  search: string;
}

/** Whether anything narrows the list: a search, a span of days, or (a list of events) some types. */
export function isFiltered(filter: SearchAndDays & { types?: readonly unknown[] }): boolean {
  return filter.search !== '' || filter.from !== null || filter.to !== null || (filter.types?.length ?? 0) > 0;
}

/**
 * The search and the days as the API takes them, added to `params`: `q`, and the days as the
 * viewer's own midnights (the page's own URL keeps them as days).
 */
export function searchAndDayParams(filter: SearchAndDays, params = new URLSearchParams()): URLSearchParams {
  if (filter.search) params.set('q', filter.search);
  const { from, to } = toInstants(filter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return params;
}
