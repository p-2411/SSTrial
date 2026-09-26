import type { LogEvent, LogLevel } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useUploadHistory } from '@/api/queries';
import { RelativeTime } from '@/components/RelativeTime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TONE_DOT_CLASSES } from '@/lib/tone';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';

/** Everyday events get a quiet grey dot; warnings and errors their tone's. */
const LEVEL_DOT: Record<LogLevel, string> = {
  info: 'bg-border',
  warn: TONE_DOT_CLASSES.warning,
  error: TONE_DOT_CLASSES.danger,
};

/**
 * The upload's history, oldest first: from being uploaded, through each attempt to read it, to
 * who edited or checked its fields. Its entries come from the activity log, and update live.
 */
export function UploadHistory({ uploadId }: { uploadId: string }) {
  const { data: events, isPending, isError, error } = useUploadHistory(uploadId);
  const now = useNow();

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
              <HistoryEntry key={event.id} event={event} now={now} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryEntry({ event, now }: { event: LogEvent; now: number }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2.5 text-sm">
      <span aria-hidden className={cn('size-2 translate-y-[-1px] rounded-full', LEVEL_DOT[event.level])} />
      <span className="wrap-anywhere">{event.message}</span>
      <RelativeTime iso={event.occurredAt} now={now} className="text-xs whitespace-nowrap text-muted-foreground tabular-nums" />
    </li>
  );
}
