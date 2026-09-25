import { useSearchParams } from 'react-router';
import type { UploadFilter } from '@label-extractor/shared';

/**
 * The list can be narrowed by status, using the tabs in the list's header. The filter lives in the
 * URL (?status=failed) so it survives refreshes and can be shared. Which statuses each view holds
 * is defined once, in shared (UPLOAD_FILTERS); the server does the filtering and counting.
 */
export interface StatusFilter {
  id: UploadFilter;
  /** Tab label. */
  label: string;
  /** Shown when the filter matches nothing. */
  emptyText: string;
}

export const STATUS_FILTERS: StatusFilter[] = [
  { id: 'all', label: 'All', emptyText: 'No uploads yet' },
  { id: 'in-progress', label: 'In progress', emptyText: 'Nothing is being processed right now.' },
  { id: 'completed', label: 'Completed', emptyText: 'No completed uploads yet.' },
  { id: 'failed', label: 'Failed', emptyText: 'No failed uploads.' },
];

const DEFAULT_FILTER = STATUS_FILTERS[0]!;

/** The active filter, read from the URL. Unknown values fall back to "All". */
export function useStatusFilter(): StatusFilter {
  const [params] = useSearchParams();
  return STATUS_FILTERS.find((filter) => filter.id === params.get('status')) ?? DEFAULT_FILTER;
}

/** The query string for a filter ("" for the default, so plain "/" stays clean). */
export function filterSearch(filter: StatusFilter): string {
  return filter === DEFAULT_FILTER ? '' : `?status=${filter.id}`;
}
