import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, OctagonAlert, XCircle } from 'lucide-react';
import type { HealthCheckResult, OpsAlert, OpsStatusResponse } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useOpsStatus } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatDuration, formatRelativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';

/**
 * Route: /status — is the system healthy, is work flowing, and what went wrong recently?
 * Everything comes from GET /api/ops, refreshed every 15 seconds.
 */
export function SystemStatusPage() {
  const { data, isPending, isError, error, refetch, isRefetching } = useOpsStatus();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto grid max-w-5xl gap-5">
        {isPending && <Skeleton className="h-96 w-full rounded-xl" />}
        {isError && !data && (
          <InlineError title="Couldn't load the system status" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        )}
        {data && <Status data={data} />}
      </div>
    </main>
  );
}

function Status({ data }: { data: OpsStatusResponse }) {
  const now = useNow(15_000);
  const { health, worker, queue, last24h, failuresByReason, alerts } = data;
  const allHealthy = health.status === 'ok' && worker.healthy;
  const critical = alerts.open.some((alert) => alert.severity === 'critical');

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">System status</h2>
          <p className="text-sm text-muted-foreground">
            Updated <time dateTime={data.generatedAt}>{formatRelativeTime(data.generatedAt, now)}</time>. Refreshes every 15 seconds.
          </p>
        </div>
        <OverallPill state={!allHealthy || critical ? 'down' : alerts.open.length > 0 ? 'degraded' : 'ok'} />
      </header>

      <section aria-label="Queue" className="grid grid-cols-4 gap-4">
        <Stat label="Waiting" value={queue.waiting} note={queue.retrying > 0 ? `${queue.retrying} waiting to retry` : undefined} />
        <Stat label="Processing" value={queue.processing} />
        <Stat label="Longest wait" value={queue.oldestWaitingSeconds === null ? '–' : formatDuration(queue.oldestWaitingSeconds)} />
        <Stat
          label="Worker"
          value={worker.healthy ? 'Running' : 'Not reporting'}
          tone={worker.healthy ? 'ok' : 'bad'}
          note={worker.lastSeenAt ? `Last seen ${formatRelativeTime(worker.lastSeenAt, now)}` : 'Never seen'}
        />
      </section>

      <div className="grid grid-cols-2 gap-4">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Health checks</CardTitle>
            <CardDescription>The API's own dependencies, checked on every refresh.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {Object.entries(health.checks).map(([name, check]) => (
                <HealthRow key={name} name={name} check={check} />
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Last 24 hours</CardTitle>
            <CardDescription>Uploads that finished, and how long they took.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Fact label="Completed">{last24h.completed}</Fact>
              <Fact label="Failed">{last24h.failed}</Fact>
              <Fact label="Failure rate">{last24h.failureRate === null ? '–' : `${Math.round(last24h.failureRate * 100)}%`}</Fact>
              <Fact label="Median time to result">
                {last24h.medianSecondsToResult === null ? '–' : formatDuration(last24h.medianSecondsToResult)}
              </Fact>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Failures by reason</CardTitle>
          <CardDescription>Uploads that failed in the last 24 hours.</CardDescription>
        </CardHeader>
        <CardContent>
          {failuresByReason.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures in the last 24 hours.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Reason</th>
                  <th className="pb-2 font-medium">Code</th>
                  <th className="pb-2 text-right font-medium">Uploads</th>
                </tr>
              </thead>
              <tbody>
                {failuresByReason.map((row) => (
                  <tr key={row.code} className="border-t">
                    <td className="py-2 pr-4">{row.message}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{row.code}</td>
                    <td className="py-2 text-right tabular-nums">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Alert log</CardTitle>
          <CardDescription>Checked every minute. An alert stays open until its problem clears.</CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.open.length === 0 && alerts.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts yet.</p>
          ) : (
            <ul className="grid gap-2">
              {[...alerts.open, ...alerts.recent].map((alert) => (
                <AlertRow key={alert.id} alert={alert} now={now} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function OverallPill({ state }: { state: 'ok' | 'degraded' | 'down' }) {
  const styles = {
    ok: { label: 'All systems working', icon: CheckCircle2, className: 'border-success-border bg-success-soft text-success' },
    degraded: { label: 'Needs attention', icon: AlertTriangle, className: 'border-warning-border bg-warning-soft text-warning' },
    down: { label: 'Something is broken', icon: OctagonAlert, className: 'border-danger-border bg-danger-soft text-danger' },
  }[state];
  return (
    <Badge variant="outline" role="status" className={cn('h-8 gap-1.5 rounded-full px-3 text-sm', styles.className)}>
      <styles.icon aria-hidden />
      {styles.label}
    </Badge>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: 'ok' | 'bad' }) {
  return (
    <Card className="gap-1 px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums', tone === 'ok' && 'text-success', tone === 'bad' && 'text-danger')}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}

function HealthRow({ name, check }: { name: string; check: HealthCheckResult }) {
  const ok = check.status === 'ok';
  return (
    <li className="flex items-start justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 capitalize">
        {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className="size-4 text-danger" aria-hidden />}
        {name}
      </span>
      <span className={cn('text-right', ok ? 'text-muted-foreground tabular-nums' : 'text-danger')}>
        {ok ? `${check.latencyMs} ms` : check.error}
      </span>
    </li>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function AlertRow({ alert, now }: { alert: OpsAlert; now: number }) {
  const open = alert.resolvedAt === null;
  return (
    <li className={cn('grid gap-1 rounded-lg border px-4 py-3', open ? 'bg-card' : 'bg-muted/40 text-muted-foreground')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            'rounded-full',
            !open && 'border-border text-muted-foreground',
            open && alert.severity === 'critical' && 'border-danger-border bg-danger-soft text-danger',
            open && alert.severity === 'warning' && 'border-warning-border bg-warning-soft text-warning',
          )}
        >
          {open ? (alert.severity === 'critical' ? 'Critical' : 'Warning') : 'Resolved'}
        </Badge>
        <p className={cn('font-semibold', open && 'text-foreground')}>{alert.title}</p>
        <span className="ml-auto text-xs tabular-nums" title={formatDateTime(alert.firstSeenAt)}>
          {open
            ? `Since ${formatRelativeTime(alert.firstSeenAt, now)}`
            : `${formatRelativeTime(alert.firstSeenAt, now)}, lasted ${formatDuration((Date.parse(alert.resolvedAt!) - Date.parse(alert.firstSeenAt)) / 1000)}`}
        </span>
      </div>
      <p className="text-sm">{alert.message}</p>
    </li>
  );
}
