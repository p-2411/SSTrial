import { useSearchParams } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, Files, Loader2, XCircle } from 'lucide-react';
import type { UploadStatus } from '@label-extractor/shared';

/**
 * The list can be narrowed by status. The filter lives in the URL (?status=failed) so it survives
 * refreshes, can be shared, and is shown in the sidebar.
 */
export interface StatusFilter {
  id: 'all' | 'in-progress' | 'completed' | 'failed';
  label: string;
  icon: LucideIcon;
  matches: (status: UploadStatus) => boolean;
  /** Shown when the filter matches nothing. */
  emptyText: string;
}

export const STATUS_FILTERS: StatusFilter[] = [
  { id: 'all', label: 'All uploads', icon: Files, matches: () => true, emptyText: 'No uploads yet' },
  {
    id: 'in-progress',
    label: 'In progress',
    icon: Loader2,
    matches: (status) => status === 'queued' || status === 'processing',
    emptyText: 'Nothing is being processed right now.',
  },
  {
    id: 'completed',
    label: 'Completed',
    icon: CheckCircle2,
    matches: (status) => status === 'completed',
    emptyText: 'No completed uploads yet.',
  },
  {
    id: 'failed',
    label: 'Failed',
    icon: XCircle,
    matches: (status) => status === 'failed',
    emptyText: 'No failed uploads.',
  },
];

const DEFAULT_FILTER = STATUS_FILTERS[0]!;

/** The active filter, read from the URL. Unknown values fall back to "All uploads". */
export function useStatusFilter(): StatusFilter {
  const [params] = useSearchParams();
  return STATUS_FILTERS.find((filter) => filter.id === params.get('status')) ?? DEFAULT_FILTER;
}

/** The query string for a filter ("" for the default, so plain "/" stays clean). */
export function filterSearch(filter: StatusFilter): string {
  return filter === DEFAULT_FILTER ? '' : `?status=${filter.id}`;
}
