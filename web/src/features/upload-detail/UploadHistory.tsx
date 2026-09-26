import { useState } from 'react';
import { ChevronRight, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { UPLOAD_EVENT_TYPE_IDS, type LogLevel, type UploadDetail, type UploadHistoryEntry } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { isFiltered, NO_ACTIVITY_FILTERS, type ActivityFilters } from '@/api/logs';
import { isEditConflict, useRevertUpload, useUploadHistory } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { FadeWhileLoading } from '@/components/FadeWhileLoading';
import { InlineError } from '@/components/InlineError';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { ActivityFilterBar } from '@/features/activity/ActivityFilterBar';
import { EVENT_ACTION_CLASS, EventDetails, EventDetailsTrigger } from '@/features/activity/EventDetails';
import { formatDateAndTime, formatDateTimeWithSeconds } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Everyday events read plainly; warnings and errors take their tone's colour. */
const LEVEL_TEXT: Record<LogLevel, string> = {
  info: '',
  warn: 'text-warning',
  error: 'text-danger',
};

type Upload = Pick<UploadDetail, 'id' | 'revision' | 'canRevert'>;

/**
 * The upload's history, newest first: from being uploaded, through each attempt to read it, to
 * who edited or checked its fields. Its entries come from the activity log, and update live.
 *
 * Collapsed until opened, and nothing is fetched until then: most visits never look. Once open,
 * it's a page at a time ("Load older"), searchable and filtered like the activity log, and each
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
        <div aria-label="Loading history" className="grid gap-2">
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

/**
 * When it happened (to the second, on hover), what happened, then, always in view on its right
 * however long the message runs, "Revert" for an admin, and "Details" for a change to the data
 * (what it changed, or the data as read).
 */
function HistoryEntry({ uploadId, entry, onRevert }: { uploadId: string; entry: UploadHistoryEntry; onRevert?: () => void }) {
  return (
    // Each entry takes the list's columns (a subgrid), so Details and Revert line up down the list.
    <li className="col-span-full grid grid-cols-subgrid">
      <Collapsible className="group/event col-span-full grid grid-cols-subgrid items-baseline text-sm">
        <time
          dateTime={entry.occurredAt}
          title={formatDateTimeWithSeconds(entry.occurredAt)}
          className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {formatDateAndTime(entry.occurredAt)}
        </time>
        <span className={cn('wrap-anywhere', LEVEL_TEXT[entry.level])}>{entry.message}</span>
        {/* Revert first: it comes and goes, so Details, on every change, keeps to the right edge. */}
        {onRevert ? (
          <button type="button" className={EVENT_ACTION_CLASS} onClick={onRevert}>
            <Undo2 aria-hidden />
            <span>Revert</span>
          </button>
        ) : (
          <span />
        )}
        {entry.hasDetails ? <EventDetailsTrigger /> : <span />}
        <CollapsibleContent className="col-span-3 col-start-2 min-w-0">
          <EventDetails source={{ uploadId }} eventId={entry.id} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * Asks before reverting, since it undoes later edits and checks. Made against the revision on
 * screen, so it can't undo a change the admin hasn't seen: if someone saved meanwhile, it's
 * refused, and they can look again.
 */
function RevertDialog({ upload, entry, onClose }: { upload: Upload; entry: UploadHistoryEntry | null; onClose: () => void }) {
  const revert = useRevertUpload(upload.id);

  const confirm = () => {
    if (!entry?.revertTo) return;
    revert.mutate(
      { revision: upload.revision, versionId: entry.revertTo },
      {
        onSuccess: () => {
          toast.success('Reverted');
          onClose();
        },
      },
    );
  };

  return (
    <ConfirmDialog
      open={entry !== null}
      title="Revert to this point?"
      description={
        <>
          The data goes back to how it was on {entry && formatDateAndTime(entry.occurredAt)}, and checks made since are undone. The
          revert is recorded in the history, so it can be undone too.
        </>
      }
      confirmLabel="Revert"
      cancelLabel="Keep it"
      request={revert}
      describeError={(error) =>
        isEditConflict(error) ? 'Someone changed this upload since you opened it. Close this and look again.' : errorMessage(error)
      }
      confirmDisabled={isEditConflict(revert.error)}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
