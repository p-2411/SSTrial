import type { LogEvent, LogLevel } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useUploadHistory } from '@/api/queries';
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

/**
 * The upload's history, oldest first: from being uploaded, through each attempt to read it, to
 * who edited or checked its fields. Its entries come from the activity log, and update live.
 */
export function UploadHistory({ uploadId }: { uploadId: string }) {
  const { data: events, isPending, isError, error } = useUploadHistory(uploadId);

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
        {events?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing recorded. Uploads from before the history existed have none.</p>
        )}
        {events && events.length > 0 && (
          <ol className="grid gap-2.5">
            {events.map((event) => (
              <HistoryEntry key={event.id} event={event} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** When it happened (to the second, on hover), then what happened. */
function HistoryEntry({ event }: { event: LogEvent }) {
  return (
    <li className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-3 text-sm">
      <time
        dateTime={event.occurredAt}
        title={formatDateTimeWithSeconds(event.occurredAt)}
        className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
      >
        {formatDateAndTime(event.occurredAt)}
      </time>
      <span className={cn('wrap-anywhere', LEVEL_TEXT[event.level])}>{event.message}</span>
    </li>
  );
}
