import { useMemo, useState } from 'react';
import { ChevronRight, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { UPLOAD_EVENT_TYPE_IDS, type LogLevel, type UploadDetail, type UploadHistoryEntry } from '@label-extractor/shared';
import { ApiRequestError, errorMessage } from '@/api/client';
import { isFiltered, NO_ACTIVITY_FILTERS, type ActivityFilters } from '@/api/logs';
import { useRevertUpload, useUploadHistory } from '@/api/queries';
import { ActivityFilterBar } from '@/features/activity/ActivityFilterBar';
import { EVENT_ACTION_CLASS, EventDetails, EventDetailsTrigger } from '@/features/activity/EventDetails';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
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

/** The open history: its filters, its entries so far, and "Load older". Only mounted once opened. */
function HistoryBody({ upload }: { upload: Upload }) {
  const [filters, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS);
  const history = useUploadHistory(upload.id, filters);
  const entries = useMemo(() => history.data?.pages.flatMap((page) => page.entries), [history.data]);
  const [reverting, setReverting] = useState<UploadHistoryEntry | null>(null);
  const { isPending, isError, error, isPlaceholderData } = history;
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
      {isError && <p className="text-sm text-muted-foreground">Couldn't load the history. {errorMessage(error)}</p>}
      {entries?.length === 0 && (
        <div className="grid justify-items-start gap-2">
          <p className="text-sm text-muted-foreground">
            {filtered ? 'Nothing in the history matches these filters.' : 'Nothing recorded. Uploads from before the history existed have none.'}
          </p>
          {filtered && (
            <Button variant="outline" size="sm" onClick={() => setFilters(NO_ACTIVITY_FILTERS)}>
              Show all of it
            </Button>
          )}
        </div>
      )}
      {entries && entries.length > 0 && (
        // While a new search or filter loads, the last results stay, faded, rather than blinking out.
        <ol
          aria-busy={isPlaceholderData || undefined}
          className={cn('grid grid-cols-[7rem_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-2.5 transition-opacity', isPlaceholderData && 'opacity-60')}
        >
          {entries.map((entry) => (
            <HistoryEntry
              key={entry.id}
              uploadId={upload.id}
              entry={entry}
              onRevert={upload.canRevert && entry.revertTo !== null ? () => setReverting(entry) : undefined}
            />
          ))}
        </ol>
      )}
      {history.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-center"
          onClick={() => void history.fetchNextPage()}
          loading={history.isFetchingNextPage}
        >
          Load older
        </Button>
      )}
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
 * Asks before reverting, since it undoes later edits and checks, and stays open until it's done or
 * says why it couldn't be. Made against the revision on screen, so it can't undo a change the admin
 * hasn't seen: if someone saved meanwhile, it's refused, and they can look again.
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
  const onOpenChange = (open: boolean) => {
    if (open || revert.isPending) return; // no walking away mid-revert
    revert.reset();
    onClose();
  };
  const conflict = revert.error instanceof ApiRequestError && revert.error.code === 'EDIT_CONFLICT';

  return (
    <AlertDialog open={entry !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revert to this point?</AlertDialogTitle>
          <AlertDialogDescription>
            The data goes back to how it was on {entry && formatDateAndTime(entry.occurredAt)}, and checks made since are undone.
            The revert is recorded in the history, so it can be undone too.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {revert.isError && (
          <p role="alert" className="text-danger">
            {conflict ? 'Someone changed this upload since you opened it. Close this and look again.' : errorMessage(revert.error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={revert.isPending}>
              Keep it
            </Button>
          </AlertDialogCancel>
          <Button loading={revert.isPending} disabled={conflict} onClick={confirm}>
            Revert
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
