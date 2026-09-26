import { Children, useMemo, type ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { errorMessage } from '@/api/client';
import { useUploadCounts, useUploadList } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { rowClassName } from '@/components/UploadRowLayout';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TONE_CLASSES } from '@/lib/tone';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { ExportMenu } from './ExportMenu';
import { StatusTabs } from './StatusTabs';
import { UploadRow } from './UploadRow';
import { useSetStatusFilter, useStatusFilter, type StatusFilter } from './statusFilters';
import { useStatusAnnouncements } from './useStatusAnnouncements';

interface UploadListProps {
  /**
   * List items (<li>, laid out with UploadRowLayout) shown above the server's uploads, such as
   * files still being sent from this browser.
   */
  leadingRows?: ReactNode;
}

export function UploadList({ leadingRows }: UploadListProps) {
  const filter = useStatusFilter();
  const setFilter = useSetStatusFilter();
  const list = useUploadList(filter.id);
  const { data: counts } = useUploadCounts();
  const now = useNow();

  // The server filters and pages; this is just every page loaded so far, in order. Memoised so it's
  // only a new array when the data changes: the list also re-renders for upload progress and the
  // clock, and the announcements effect below depends on this array.
  const uploads = useMemo(() => list.data?.pages.flatMap((page) => page.uploads), [list.data]);
  const announcement = useStatusAnnouncements(uploads);
  const { isPending, isError, error, refetch, isRefetching } = list;

  const hasRows = Children.toArray(leadingRows).length > 0 || (uploads !== undefined && uploads.length > 0);
  const hasCompleted = (counts?.completed ?? 0) > 0;

  return (
    <Card aria-labelledby="uploads-heading" className="gap-0 py-0" role="region">
      {/* The URL is the source of truth: switching tab navigates to ?status=…, keeping any open upload. */}
      <Tabs value={filter.id} onValueChange={setFilter} className="gap-0">
        <CardHeader className="gap-3 border-b border-border/70 py-4">
          <CardTitle id="uploads-heading" className="text-base font-semibold">
            Uploads
          </CardTitle>
          {/* Only offered once there's extracted data to export. */}
          {hasCompleted && (
            <CardAction>
              <ExportMenu />
            </CardAction>
          )}
          <div className="col-span-full">
            <StatusTabs counts={counts} />
          </div>
        </CardHeader>

        {/* One panel for every tab: its rows come from the server, filtered by the active tab. */}
        <TabsContent value={filter.id}>
          {/* Refresh failed but we still have data: keep showing it, and say it may be out of date. */}
          {isError && uploads && <StaleListBanner error={error} />}

          {hasRows && (
            <ul>
              {leadingRows}
              {uploads?.map((upload) => <UploadRow key={upload.id} upload={upload} now={now} />)}
            </ul>
          )}

          {list.hasNextPage && (
            <div className="border-t border-border/70 p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}

          {isPending && <ListSkeleton />}

          {isError && !uploads && (
            <div className="p-4">
              <InlineError
                title="Couldn't load your uploads"
                message={errorMessage(error)}
                onRetry={() => void refetch()}
                retrying={isRefetching}
              />
            </div>
          )}

          {!hasRows && uploads && <EmptyState filter={filter} />}
        </TabsContent>
      </Tabs>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
}

function StaleListBanner({ error }: { error: Error | null }) {
  return (
    <p role="status" className={cn('border-b px-4 py-2 text-sm', TONE_CLASSES.warning)}>
      Couldn't refresh the list, so statuses may be out of date. {errorMessage(error)}
    </p>
  );
}

/** Nothing matches the filter. With no filter at all, nothing has been uploaded yet: say how to start. */
function EmptyState({ filter }: { filter: StatusFilter }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="size-5" aria-hidden />
      </span>
      <p className="font-semibold">{filter.emptyText}</p>
      {filter.id === 'all' && (
        <p className="max-w-sm text-sm text-muted-foreground">
          Add a label photo or PDF above. Each file is read in the background, and its product name, brand,
          ingredients, allergens and net weight appear here.
        </p>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul aria-label="Loading uploads">
      {[0, 1, 2].map((i) => (
        <li key={i} className={rowClassName}>
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
