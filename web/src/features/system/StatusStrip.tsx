import type { ReactNode } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatList, type HealthCheckResult, type OpsStatusResponse } from '@label-extractor/shared';
import { Card } from '@/components/ui/card';
import { formatDuration, formatOptional, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tone = 'ok' | 'bad';

/**
 * Is the system healthy, and is work flowing? One row of figures above the activity log: what's
 * waiting, retrying and being read now; the last 24 hours; and whether the system's own checks
 * pass, workers included (the detail on hover, or in plain view when one fails).
 */
export function StatusStrip({ status, now }: { status: OpsStatusResponse; now: number }) {
  const { queue, worker, last24h, health } = status;
  return (
    <Card aria-label="System status" role="region" className="grid grid-cols-7 gap-0 divide-x divide-border/70 py-0">
      <Stat label="Waiting" value={queue.waiting} />
      <Stat label="Retrying" value={queue.retrying} />
      <Stat label="Processing" value={queue.processing} />
      <Stat label="Read (24h)" value={last24h.completed} />
      <Stat
        label="Failed (24h)"
        value={last24h.failed}
        note={formatOptional(last24h.failureRate, (rate) => `${Math.round(rate * 100)}% of reads`)}
      />
      <Stat label="Typical time" value={formatOptional(last24h.medianSecondsToResult, formatDuration)} note="Upload to read" />
      <Checks checks={systemChecks(health.checks, worker, now)} />
    </Card>
  );
}

interface Check {
  name: string;
  ok: boolean;
  /** How it went: shown on hover. */
  detail: string;
  /** What's wrong, when it isn't OK: shown under the figure. */
  problem?: string;
}

/**
 * The API's own health checks (database, queue), plus the workers that read labels: OK while one
 * has checked in within the last few minutes (see OpsStore.recordWorkerHeartbeat).
 */
function systemChecks(checks: Record<string, HealthCheckResult>, worker: OpsStatusResponse['worker'], now: number): Check[] {
  const seen = worker.lastSeenAt && formatRelativeTime(worker.lastSeenAt, now);
  return [
    ...Object.entries(checks).map(([name, check]) => ({
      name,
      ok: check.status === 'ok',
      detail: check.status === 'ok' ? `OK, ${check.latencyMs} ms` : (check.error ?? 'Failing'),
      problem: check.error,
    })),
    {
      name: 'workers',
      ok: worker.healthy,
      detail: worker.healthy ? `OK, seen ${seen}` : seen ? `Last seen ${seen}` : 'Never seen',
      problem: seen ? `No worker seen since ${seen}.` : 'No worker has started.',
    },
  ];
}

/**
 * The checks as one figure: all OK, or which failed, by name ("Database and workers down"), and
 * why. Each check's detail on hover.
 */
function Checks({ checks }: { checks: Check[] }) {
  const failing = checks.filter((check) => !check.ok);
  const ok = failing.length === 0;
  return (
    <Stat
      label="Systems"
      value={
        // The circled tick or cross the checks each had on the old status page.
        <span className="inline-flex items-center gap-1.5">
          {ok ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}
          {ok ? 'All OK' : `${capitalise(formatList(failing.map((check) => check.name), 'and'))} down`}
        </span>
      }
      tone={ok ? 'ok' : 'bad'}
      note={ok ? undefined : failing.map((check) => check.problem).join(' ')}
      title={checks.map((check) => `${capitalise(check.name)}: ${check.detail}`).join('\n')}
    />
  );
}

function Stat({ label, value, note, tone, title }: { label: string; value: ReactNode; note?: string; tone?: Tone; title?: string }) {
  return (
    <div className="grid content-start gap-0.5 px-4 py-3" title={title}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-semibold tabular-nums', tone === 'ok' && 'text-success', tone === 'bad' && 'text-danger')}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
