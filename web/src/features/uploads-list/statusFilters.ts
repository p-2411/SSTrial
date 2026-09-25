import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { UPLOAD_FILTER_IDS, type UploadFilter } from '@label-extractor/shared';
import { refreshUploadCounts } from '@/api/queries';

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

/** Keyed by filter, so a view added in shared doesn't type-check until it has its wording here. */
const FILTER_TEXT = {
  all: { label: 'All', emptyText: 'No uploads yet' },
  'in-progress': { label: 'In progress', emptyText: 'Nothing is being processed right now.' },
  completed: { label: 'Completed', emptyText: 'No completed uploads yet.' },
  failed: { label: 'Failed', emptyText: 'No failed uploads.' },
} satisfies Record<UploadFilter, Omit<StatusFilter, 'id'>>;

/** In shared's order, which is the order the tabs appear in. */
export const STATUS_FILTERS: StatusFilter[] = UPLOAD_FILTER_IDS.map((id) => ({ id, ...FILTER_TEXT[id] }));

const DEFAULT_FILTER = STATUS_FILTERS.find((filter) => filter.id === 'all')!;

/** The active filter, read from the URL. Unknown values fall back to "All". */
export function useStatusFilter(): StatusFilter {
  const [params] = useSearchParams();
  return STATUS_FILTERS.find((filter) => filter.id === params.get('status')) ?? DEFAULT_FILTER;
}

/**
 * Switches the list to another filter by navigating to ?status=…, keeping any open upload.
 * Unknown ids are ignored.
 */
export function useSetStatusFilter(): (id: string) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  return (id) => {
    const next = STATUS_FILTERS.find((filter) => filter.id === id);
    if (!next) return;
    void navigate({ pathname, search: filterSearch(next) });
    // The counts sit right beside the list, so refresh them too; they'd otherwise only update
    // while something is in progress, and a tab's number could disagree with its rows.
    void refreshUploadCounts(queryClient);
  };
}

/** The query string for a filter ("" for the default, so plain "/" stays clean). */
function filterSearch(filter: StatusFilter): string {
  return filter === DEFAULT_FILTER ? '' : `?status=${filter.id}`;
}
