import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Inbox } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/api/client';
import { uploadKeys, useUploadCounts, useUploadList } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/InlineError';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useNow } from '@/lib/useNow';
import { PendingUploadRow } from '@/features/upload/PendingUploadRow';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { ExportMenu } from './ExportMenu';
import { rowClassName, UploadRow } from './UploadRow';
import { StatusTabs } from './StatusTabs';
import { filterSearch, STATUS_FILTERS, useStatusFilter } from './statusFilters';
import { useStatusAnnouncements } from './useStatusAnnouncements';

interface UploadListProps {
  /** Files still being sent from this browser; shown above the server's list. */
  pending: PendingUpload[];
  onRetryPending: (upload: PendingUpload) => void;
  onDismissPending: (localId: string) => void;
}

export function UploadList({ pending, onRetryPending, onDismissPending }: UploadListProps) {
  const filter = useStatusFilter();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const list = useUploadList(filter.id);
  const { data: counts } = useUploadCounts();
  const now = useNow();

  // The server filters and pages; this is just every page loaded so far, in order. Memoised so it's
  // only a new array when the data changes: the list also re-renders for upload progress and the
  // clock, and the announcements effect below depends on this array.
  const uploads = useMemo(() => list.data?.pages.flatMap((page) => page.uploads), [list.data]);
  const announcement = useStatusAnnouncements(uploads);
  const { isPending, isError, error, refetch, isRefetching } = list;

  const hasRows = pending.length > 0 || (uploads !== undefined && uploads.length > 0);
  const hasCompleted = (counts?.completed ?? 0) > 0;

  return (
    <Card aria-labelledby="uploads-heading" className="gap-0 py-0" role="region">
      {/* The URL is the source of truth: switching tab navigates to ?status=…, keeping any open upload. */}
      <Tabs
        value={filter.id}
        onValueChange={(id) => {
          const next = STATUS_FILTERS.find((f) => f.id === id);
          if (!next) return;
          navigate({ pathname, search: filterSearch(next) });
          // The counts sit right beside the list, so refresh them too; they'd otherwise only update
          // while something is in progress, and a tab's number could disagree with its rows.
          void queryClient.invalidateQueries({ queryKey: uploadKeys.counts() });
        }}
        className="gap-0"
      >
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
          {isError && uploads && (
            <p role="status" className="border-b border-warning-border bg-warning-soft px-4 py-2 text-sm text-warning">
              Couldn't refresh the list, so statuses may be out of date. {errorMessage(error)}
            </p>
          )}

          {hasRows && (
            <ul>
              {pending.map((upload) => (
                <PendingUploadRow key={upload.localId} upload={upload} onRetry={onRetryPending} onDismiss={onDismissPending} />
              ))}
              {uploads?.map((upload) => <UploadRow key={upload.id} upload={upload} now={now} />)}
            </ul>
          )}

          {list.hasNextPage && (
            <div className="border-t border-border/70 p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
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

          {!hasRows && uploads && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="size-5" aria-hidden />
              </span>
              <p className="font-semibold">{filter.emptyText}</p>
              {filter.id === 'all' && uploads.length === 0 && (
                <p className="max-w-sm text-sm text-muted-foreground">
                  Add a label photo or PDF above. Each file is read in the background, and its product name, brand,
                  ingredients, allergens and net weight appear here.
                </p>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Card>
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
