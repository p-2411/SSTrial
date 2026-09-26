import { useMemo } from 'react';
import { ScrollText } from 'lucide-react';
import { LOG_RETENTION_DAYS, type LogEvent } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { isFiltered, type LogFilters } from '@/api/logs';
import { useActivityLog } from '@/api/queries';
import { EmptyState } from '@/components/EmptyState';
import { FadeWhileLoading } from '@/components/FadeWhileLoading';
import { InlineError } from '@/components/InlineError';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/lib/useNow';
import { groupByDay } from './groupByDay';
import { NO_ACTIVITY_LOG_FILTERS, useActivityLogFilters } from './activityLogFilters';
import { ActivityLogFilterBar } from './ActivityLogFilterBar';
import { ActivityLogRow } from './ActivityLogRow';

/**
 * The activity log, on the System page: what happened to each upload and to the system, newest
 * first, grouped by day. Searchable, and filtered by type of event, by day and by upload, all in
 * the URL. Live: new events appear as they're written (see useLiveUpdates).
 */
export function ActivityLog() {
  const [filters, setFilters] = useActivityLogFilters();
  const log = useActivityLog(filters);
  // Only for the "Today" and "Yesterday" headings, so once a minute is plenty.
  const now = useNow(60_000);

  const events = log.data; // every page loaded so far
  const days = useMemo(() => (events ? groupByDay(events, now) : []), [events, now]);
  const { isPending, isError, isRefetchError, error, refetch, isRefetching, isPlaceholderData } = log;

  return (
    <Card aria-labelledby="logs-heading" role="region" className="gap-0 py-0">
      <CardHeader className="gap-3 border-b border-border/70 py-4">
        <CardTitle id="logs-heading" className="text-base font-semibold">
          Activity log
        </CardTitle>
        <div className="col-span-full pt-1">
          <ActivityLogFilterBar filters={filters} onChange={setFilters} uploadName={filters.upload ? fileNameIn(events) : null} />
        </div>
      </CardHeader>

      {isRefetchError && (
        <StaleDataNotice what="the activity log" error={error} onRetry={() => void refetch()} retrying={isRefetching} className="px-5" />
      )}

      {/* Every row has a line beneath it, so each day's heading is ruled above and below. Only the
          very last row goes without: the card's edge, or "Load more", follows it. */}
      {days.length > 0 && (
        <FadeWhileLoading loading={isPlaceholderData}>
          {days.map((day) => (
            <section key={day.key} aria-label={day.label} className="last-of-type:[&_li:last-child]:border-b-0">
              <h3 className="border-b border-border/70 bg-muted/40 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
                {day.label}
              </h3>
              <ul>
                {day.events.map((event) => (
                  <ActivityLogRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </FadeWhileLoading>
      )}

      <LoadMoreButton query={log} className="border-t border-border/70 p-3" />

      {isPending && <LogSkeleton />}

      {isError && !events && (
        <div className="p-4">
          <InlineError title="Couldn't load the activity log" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        </div>
      )}

      {events?.length === 0 && <NoEvents filters={filters} onClearFilters={() => setFilters(NO_ACTIVITY_LOG_FILTERS)} />}
    </Card>
  );
}

/** Every upload event records its file's name, so the upload filter can name the file. */
function fileNameIn(events: LogEvent[] | undefined): string | null {
  return events?.find((event) => event.fileName !== null)?.fileName ?? null;
}

/** Nothing to show: nothing has happened yet, or nothing matches the filters (which it offers to clear). */
function NoEvents({ filters, onClearFilters }: { filters: LogFilters; onClearFilters: () => void }) {
  const filtered = isFiltered(filters) || filters.upload !== null;
  const justOneUpload = filters.upload !== null && !isFiltered(filters);
  const title = justOneUpload
    ? 'Nothing recorded for this upload'
    : filters.search
      ? `No events mention “${filters.search}”`
      : filtered
        ? 'No events match these filters'
        : 'Nothing has happened yet';
  const hint = justOneUpload
    ? `A deleted upload's events are kept for ${LOG_RETENTION_DAYS} days, and uploads from before the activity log existed have none.`
    : filters.search
      ? 'Try fewer words, or part of a file name.'
      : filtered
        ? undefined
        : 'Upload a label and each step of its journey appears here.';
  return <EmptyState icon={ScrollText} title={title} hint={hint} action={filtered ? { label: 'Clear filters', onClick: onClearFilters } : undefined} />;
}

function LogSkeleton() {
  return (
    <div role="status" aria-label="Loading the activity log">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid grid-cols-[4.5rem_4.75rem_minmax(0,1fr)] gap-x-3 border-b border-border/70 px-5 py-3 last:border-b-0">
          <Skeleton className="h-3.5 w-14" />
          <span />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
