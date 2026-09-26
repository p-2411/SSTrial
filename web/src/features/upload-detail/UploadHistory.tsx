import { useState } from 'react';
import { ChevronRight, Undo2 } from 'lucide-react';
import { UPLOAD_EVENT_TYPE_IDS, type UploadDetail, type UploadHistoryEntry } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { isFiltered } from '@/api/filters';
import { NO_ACTIVITY_FILTERS, type ActivityFilters } from '@/api/logs';
import { useUploadHistory } from '@/api/queries';
import { EmptyState } from '@/components/EmptyState';
import { FadeWhileLoading } from '@/components/FadeWhileLoading';
import { InlineError } from '@/components/InlineError';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { ActivityFilterBar } from '@/features/activity/ActivityFilterBar';
import { EVENT_ACTION_CLASS } from '@/features/activity/EventDetails';
import { EventRow } from '@/features/activity/EventRow';
import { formatDateAndTime } from '@/lib/format';
import { LEVEL_TONE, TONE_TEXT_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { RevertDialog } from './RevertDialog';

type Upload = Pick<UploadDetail, 'id' | 'revision' | 'canRevert'>;

/**
 * The upload's history, newest first: from being uploaded, through each attempt to read it, to
 * who edited or checked its fields. Its entries come from the activity log, and update live.
 *
 * Collapsed until opened, and nothing is fetched until then: most visits never look. Once open,
 * it's a page at a time ("Load more"), searchable and filtered like the activity log, and each
 * change's details (what it did to the data) are fetched only when opened.
 *
 * An admin can put a completed upload's data back to any point where it changed: "Revert",
 * on the entries the server says can be gone back to (`revertTo`), when it says they may (`canRevert`).
 */
export function UploadHistory({ upload }: { upload: Upload }) {
  return (
    <Card role="region" aria-label="History" className="gap-0 py-0">
      <Collapsible className="group/history">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-4 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none group-data-[state=open]/history:rounded-b-none">
          <span className="text-base font-semibold">History</span>
          {/* Points right when collapsed, down when open. */}
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/history:rotate-90"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <HistoryBody upload={upload} />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** The open history: its filters, its entries so far, and "Load more". Only mounted once opened. */
function HistoryBody({ upload }: { upload: Upload }) {
  const [filters, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS);
  const history = useUploadHistory(upload.id, filters);
  const entries = history.data; // every page loaded so far
  const [reverting, setReverting] = useState<UploadHistoryEntry | null>(null);
  const { isPending, isError, isRefetchError, error, refetch, isRefetching, isPlaceholderData } = history;
  const filtered = isFiltered(filters);

  return (
    <div className="grid gap-3 px-4 pb-4">
      <ActivityFilterBar
        filters={filters}
        onChange={(changes) => setFilters((current) => ({ ...current, ...changes }))}
        types={UPLOAD_EVENT_TYPE_IDS}
        searchLabel="Search this history"
        searchPlaceholder="Search by person or change"
        // One row: the search takes what the two menus leave.
        className="flex-nowrap"
        searchClassName="w-auto min-w-36 flex-1"
      />
      {isPending && (
        <div role="status" aria-label="Loading history" className="grid gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {isError && !entries && (
        <InlineError title="Couldn't load the history" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
      )}
      {isRefetchError && (
        <StaleDataNotice what="the history" error={error} onRetry={() => void refetch()} retrying={isRefetching} className="rounded-md border px-3" />
      )}
      {entries?.length === 0 &&
        (filtered ? (
          <EmptyState compact title="Nothing in the history matches these filters." action={{ label: 'Clear filters', onClick: () => setFilters(NO_ACTIVITY_FILTERS) }} />
        ) : (
          <EmptyState compact title="Nothing recorded." hint="Uploads from before the history existed have none." />
        ))}
      {entries && entries.length > 0 && (
        <FadeWhileLoading loading={isPlaceholderData}>
          <ol className="grid grid-cols-[7rem_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-2.5">
            {entries.map((entry) => (
              <HistoryEntry
                key={entry.id}
                uploadId={upload.id}
                entry={entry}
                onRevert={upload.canRevert && entry.revertTo !== null ? () => setReverting(entry) : undefined}
              />
            ))}
          </ol>
        </FadeWhileLoading>
      )}
      <LoadMoreButton query={history} />
      <RevertDialog upload={upload} entry={reverting} onClose={() => setReverting(null)} />
    </div>
  );
}

/** An entry in the history: see EventRow. Revert, for an admin, where the data can be put back to. */
function HistoryEntry({ uploadId, entry, onRevert }: { uploadId: string; entry: UploadHistoryEntry; onRevert?: () => void }) {
  const tone = LEVEL_TONE[entry.level];
  return (
    // Each entry takes the list's columns (a subgrid), so Details and Revert line up down the list.
    <li className="col-span-full grid grid-cols-subgrid">
      <EventRow
        event={entry}
        source={{ uploadId }}
        time={formatDateAndTime(entry.occurredAt)}
        className="col-span-full grid-cols-subgrid text-sm"
        timeClassName="text-xs whitespace-nowrap"
        detailsClassName="col-span-3 col-start-2"
        // Revert first: it comes and goes, so Details, on every change, keeps to the right edge.
        actions={[
          onRevert && (
            <button type="button" className={EVENT_ACTION_CLASS} onClick={onRevert}>
              <Undo2 aria-hidden />
              <span>Revert</span>
            </button>
          ),
        ]}
      >
        {/* Everyday events read plainly; warnings and errors take their tone's colour. */}
        <span className={cn('wrap-anywhere', tone && TONE_TEXT_CLASSES[tone])}>{entry.message}</span>
      </EventRow>
    </li>
  );
}
