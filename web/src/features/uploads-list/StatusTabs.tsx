import type { UploadCountsResponse } from '@label-extractor/shared';
import { SegmentedTabsList, SegmentedTabsTrigger } from '@/components/SegmentedTabs';
import { STATUS_FILTERS } from './statusFilters';

/**
 * The status filter as a segmented tab control with live counts. It sits in the list's own header
 * because it only changes the list: a filter that narrows one panel shouldn't look like app-level
 * navigation.
 *
 * Must be rendered inside the list's <Tabs>, which ties the selection to the URL.
 */
export function StatusTabs({ counts }: { counts: UploadCountsResponse['counts'] | undefined }) {
  return (
    <SegmentedTabsList aria-label="Filter uploads by status">
      {STATUS_FILTERS.map((filter) => (
        <SegmentedTabsTrigger key={filter.id} value={filter.id}>
          {filter.label}
          {/* The space keeps the accessible name "Failed 1" rather than "Failed1". */}
          {counts ? (
            <>
              {' '}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{counts[filter.id]}</span>
            </>
          ) : null}
        </SegmentedTabsTrigger>
      ))}
    </SegmentedTabsList>
  );
}
