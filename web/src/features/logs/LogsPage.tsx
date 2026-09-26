import { useMemo } from 'react';
import { ScrollText } from 'lucide-react';
import { LOG_RETENTION_DAYS, type LogEvent } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import type { LogFilters } from '@/api/logs';
import { useLogs } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TONE_CLASSES } from '@/lib/tone';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { groupByDay } from './groupByDay';
import { LogEventRow } from './LogEventRow';
import { LogFilterBar } from './LogFilterBar';
import { NO_LOG_FILTERS, useLogFilters } from './logFilters';

/**
 * Route: /logs — the activity log: what happened to each upload and to the system, newest first,
 * grouped by day. Searchable, and filtered by type of event and by upload, all in the URL. Live:
 * new events appear as they're written (see useLiveUpdates).
 */
export function LogsPage() {
  const [filters, setFilters] = useLogFilters();
  const log = useLogs(filters);
  // Only for the "Today" and "Yesterday" headings, so once a minute is plenty.
  const now = useNow(60_000);

  const events = useMemo(() => log.data?.pages.flatMap((page) => page.events), [log.data]);
  const days = useMemo(() => (events ? groupByDay(events, now) : []), [events, now]);
  const { isPending, isError, error, refetch, isRefetching, isPlaceholderData } = log;

  return (
    // A <div>, not <main>: the app shell's SidebarInset is already the page's <main>.
    <div className="min-h-0 flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable_both-edges]">
      <Card aria-labelledby="logs-heading" role="region" className="mx-auto max-w-5xl gap-0 py-0">
        <CardHeader className="gap-3 border-b border-border/70 py-4">
          <CardTitle id="logs-heading" className="text-base font-semibold">
            Activity log
          </CardTitle>
          <div className="col-span-full pt-1">
            <LogFilterBar filters={filters} onChange={setFilters} uploadName={filters.upload ? fileNameIn(events) : null} />
          </div>
        </CardHeader>

        {/* Refresh failed but we still have events: keep showing them, and say they may be out of date. */}
        {isError && events && (
          <p role="status" className={cn('border-b px-5 py-2 text-sm', TONE_CLASSES.warning)}>
            Couldn't refresh the log, so recent events may be missing. {errorMessage(error)}
          </p>
        )}

        {/* Every row has a line beneath it, so each day's heading is ruled above and below. Only the
            very last row goes without: the card's edge, or "Load older events", follows it. */}
        {/* While a new search or filter loads, the last results stay, faded, rather than blinking out. */}
        {days.map((day) => (
          <section
            key={day.key}
            aria-label={day.label}
            aria-busy={isPlaceholderData || undefined}
            className={cn('transition-opacity last-of-type:[&_li:last-child]:border-b-0', isPlaceholderData && 'opacity-60')}
          >
            <h3 className="border-b border-border/70 bg-muted/40 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
              {day.label}
            </h3>
            <ul>
              {day.events.map((event) => (
                <LogEventRow key={event.id} event={event} />
              ))}
            </ul>
          </section>
        ))}

        {log.hasNextPage && (
          <div className="border-t border-border/70 p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => void log.fetchNextPage()} loading={log.isFetchingNextPage}>
              Load older events
            </Button>
          </div>
        )}

        {isPending && <LogSkeleton />}

        {isError && !events && (
          <div className="p-4">
            <InlineError title="Couldn't load the activity log" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
          </div>
        )}

        {events?.length === 0 && <EmptyState filters={filters} onClearFilters={() => setFilters(NO_LOG_FILTERS)} />}
      </Card>
    </div>
  );
}

/** Every upload event records its file's name, so the upload filter can name the file. */
function fileNameIn(events: LogEvent[] | undefined): string | null {
  const fileName = events?.find((event) => typeof event.data.fileName === 'string')?.data.fileName;
  return typeof fileName === 'string' ? fileName : null;
}

function EmptyState({ filters, onClearFilters }: { filters: LogFilters; onClearFilters: () => void }) {
  const isFiltered = filters.search !== '' || filters.types.length > 0 || filters.upload !== null;
  const justOneUpload = filters.upload !== null && filters.types.length === 0 && filters.search === '';
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <ScrollText className="size-5" aria-hidden />
      </span>
      <p className="font-semibold">
        {justOneUpload
          ? 'Nothing recorded for this upload'
          : filters.search
            ? `No events mention “${filters.search}”`
            : isFiltered
              ? 'No events match these filters'
              : 'Nothing has happened yet'}
      </p>
      {filters.search && (
        <p className="max-w-sm text-sm text-muted-foreground">
          {filters.types.length > 0 || filters.upload ? 'With these filters, in' : 'In'} the last {LOG_RETENTION_DAYS} days. Try
          fewer words, or part of a file name.
        </p>
      )}
      {justOneUpload && (
        <p className="max-w-sm text-sm text-muted-foreground">
          Events are kept for {LOG_RETENTION_DAYS} days, and uploads from before the activity log existed have none.
        </p>
      )}
      {!isFiltered && (
        <p className="max-w-sm text-sm text-muted-foreground">Upload a label and each step of its journey appears here.</p>
      )}
      {isFiltered && (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Show every event
        </Button>
      )}
    </div>
  );
}

function LogSkeleton() {
  return (
    <ul aria-label="Loading the activity log">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="grid grid-cols-[4.5rem_4.75rem_minmax(0,1fr)] gap-x-3 border-b border-border/70 px-5 py-3 last:border-b-0">
          <Skeleton className="h-3.5 w-14" />
          <span />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
