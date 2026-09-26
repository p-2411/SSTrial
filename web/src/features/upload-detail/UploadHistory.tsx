import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LogLevel, UploadDetail, UploadHistoryEntry } from '@label-extractor/shared';
import { ApiRequestError, errorMessage } from '@/api/client';
import { useRevertUpload, useUploadHistory } from '@/api/queries';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
 * The upload's history, oldest first: from being uploaded, through each attempt to read it, to
 * who edited or checked its fields. Its entries come from the activity log, and update live.
 *
 * An admin can put a completed upload's data back to any point where it changed: "Revert",
 * on the entries the server says can be gone back to (`revertTo`), when it says they may (`canRevert`).
 */
export function UploadHistory({ upload }: { upload: Upload }) {
  const { data: entries, isPending, isError, error } = useUploadHistory(upload.id);
  const [reverting, setReverting] = useState<UploadHistoryEntry | null>(null);

  return (
    <Card role="region" aria-label="History" className="gap-3">
      <CardHeader>
        <CardTitle className="text-base font-semibold">History</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending && (
          <div aria-label="Loading history" className="grid gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {isError && <p className="text-sm text-muted-foreground">Couldn't load the history. {errorMessage(error)}</p>}
        {entries?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing recorded. Uploads from before the history existed have none.</p>
        )}
        {entries && entries.length > 0 && (
          <ol className="grid gap-2.5">
            {entries.map((entry) => (
              <HistoryEntry
                key={entry.id}
                entry={entry}
                onRevert={upload.canRevert && entry.revertTo !== null ? () => setReverting(entry) : undefined}
              />
            ))}
          </ol>
        )}
      </CardContent>
      <RevertDialog upload={upload} entry={reverting} onClose={() => setReverting(null)} />
    </Card>
  );
}

/** When it happened (to the second, on hover), what happened, and for an admin, "Revert". */
function HistoryEntry({ entry, onRevert }: { entry: UploadHistoryEntry; onRevert?: () => void }) {
  return (
    <li className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-baseline gap-x-3 text-sm">
      <time
        dateTime={entry.occurredAt}
        title={formatDateTimeWithSeconds(entry.occurredAt)}
        className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
      >
        {formatDateAndTime(entry.occurredAt)}
      </time>
      <span className={cn('wrap-anywhere', LEVEL_TEXT[entry.level])}>{entry.message}</span>
      {onRevert ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto gap-1 p-0 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={onRevert}
        >
          Revert
          <Undo2 data-icon="inline-end" aria-hidden />
        </Button>
      ) : (
        <span />
      )}
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
