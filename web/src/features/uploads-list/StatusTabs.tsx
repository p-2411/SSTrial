import type { UploadCountsResponse } from '@label-extractor/shared';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { STATUS_FILTERS } from './statusFilters';

/**
 * The status filter as a segmented tab control with live counts, in the style of the tab switcher
 * on supplyscope.io. It sits in the list's own header because it only changes the list: a filter
 * that narrows one panel shouldn't look like app-level navigation.
 *
 * Must be rendered inside the list's <Tabs>, which ties the selection to the URL.
 */
export function StatusTabs({ counts }: { counts: UploadCountsResponse['counts'] | undefined }) {
  return (
    <TabsList aria-label="Filter uploads by status" className="h-9 w-full">
      {STATUS_FILTERS.map((filter) => (
        <TabsTrigger
          key={filter.id}
          value={filter.id}
          // White with a soft shadow when active, like SupplyScope's tab switcher.
          className="gap-1 px-2 text-[13px] data-active:bg-card data-active:shadow-[0_0_20px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.08)]"
        >
          {filter.label}
          {/* The space keeps the accessible name "Failed 1" rather than "Failed1". */}
          {counts && ' '}
          {counts && <span className="text-xs font-normal text-muted-foreground tabular-nums">{counts[filter.id]}</span>}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
