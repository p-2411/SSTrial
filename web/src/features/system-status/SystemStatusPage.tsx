import type { OpsStatusResponse } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { OPS_REFRESH_MS, useOpsStatus } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/lib/useNow';
import { AlertLogCard } from './AlertLogCard';
import { FailuresByReasonCard } from './FailuresByReasonCard';
import { HealthChecksCard } from './HealthChecksCard';
import { Last24HoursCard } from './Last24HoursCard';
import { QueueStats } from './QueueStats';
import { StatusHeader } from './StatusHeader';
import { overallState } from './systemState';

/**
 * Route: /status — is the system healthy, is work flowing, and what went wrong recently?
 * Everything comes from GET /api/ops, refreshed every OPS_REFRESH_MS.
 */
export function SystemStatusPage() {
  const { data, isPending, isError, error, refetch, isRefetching } = useOpsStatus();

  return (
    // A <div>, not <main>: the app shell's SidebarInset is already the page's <main>. The
    // scrollbar's space is reserved so the page doesn't shift as its height changes.
    <div className="min-h-0 flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable_both-edges]">
      <div className="mx-auto grid max-w-5xl gap-5">
        {isPending && <Skeleton className="h-96 w-full rounded-xl" />}
        {isError && !data && (
          <InlineError title="Couldn't load the system status" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        )}
        {data && <Status data={data} />}
      </div>
    </div>
  );
}

function Status({ data }: { data: OpsStatusResponse }) {
  // Relative times ("2 minutes ago") move on at the same pace as the data.
  const now = useNow(OPS_REFRESH_MS);
  return (
    <>
      <StatusHeader generatedAt={data.generatedAt} state={overallState(data)} now={now} />
      <QueueStats queue={data.queue} worker={data.worker} now={now} />
      <div className="grid grid-cols-2 gap-4">
        <HealthChecksCard checks={data.health.checks} />
        <Last24HoursCard last24h={data.last24h} />
      </div>
      <FailuresByReasonCard failures={data.failuresByReason} />
      <AlertLogCard alerts={data.alerts} now={now} />
    </>
  );
}
