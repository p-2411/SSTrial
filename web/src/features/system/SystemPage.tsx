import { errorMessage } from '@/api/client';
import { OPS_REFRESH_MS, useOpsStatus } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import { Skeleton } from '@/components/ui/skeleton';
import { ActivityLog } from '@/features/activity/log/ActivityLog';
import { useNow } from '@/lib/useNow';
import { StatusStrip } from './StatusStrip';

/**
 * Route: /system — how the system is running, for admins: the status strip on top (from GET
 * /api/ops, refreshed every OPS_REFRESH_MS), then the activity log, for what happened and why.
 */
export function SystemPage() {
  const { data, isPending, isError, error, refetch, isRefetching } = useOpsStatus();
  // Relative times ("2 minutes ago") move on at the same pace as the data.
  const now = useNow(OPS_REFRESH_MS);

  return (
    // A <div>, not <main>: the app shell's SidebarInset is already the page's <main>. The
    // scrollbar's space is reserved so the page doesn't shift as its height changes.
    <div className="min-h-0 flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable_both-edges]">
      <div className="mx-auto grid max-w-5xl gap-4">
        {isPending && <Skeleton role="status" aria-label="Loading the system status" className="h-[5.25rem] w-full rounded-xl" />}
        {isError && !data && (
          <InlineError title="Couldn't load the system status" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        )}
        {/* The strip keeps its last figures, so it mustn't go on saying "All OK" unchallenged. */}
        {isError && data && (
          <StaleDataNotice what="the system status" error={error} onRetry={() => void refetch()} retrying={isRefetching} className="rounded-xl border" />
        )}
        {data && <StatusStrip status={data} now={now} />}
        <ActivityLog />
      </div>
    </div>
  );
}
