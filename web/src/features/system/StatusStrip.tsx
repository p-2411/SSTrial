import type { ReactNode } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { HealthCheckResult, OpsStatusResponse } from '@label-extractor/shared';
import { Card } from '@/components/ui/card';
import { formatDuration, formatOptional, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tone = 'ok' | 'bad';

/**
 * Is the system healthy, and is work flowing? One row of figures above the activity log: what's
 * waiting, retrying and being read now; whether labels are being read at all; the last 24 hours;
 * and whether the system's own checks pass (the detail on hover, or in plain view when one fails).
 */
export function StatusStrip({ status, now }: { status: OpsStatusResponse; now: number }) {
  const { queue, worker, last24h, health } = status;
  return (
    <Card aria-label="System status" role="region" className="grid grid-cols-8 gap-0 divide-x divide-border/70 py-0">
      <Stat label="Waiting" value={queue.waiting} />
      <Stat label="Retrying" value={queue.retrying} />
      <Stat label="Processing" value={queue.processing} />
      <Stat
        label="Label reading"
        value={worker.healthy ? 'Running' : 'Stopped'}
        tone={worker.healthy ? 'ok' : 'bad'}
        note={worker.lastSeenAt ? `Seen ${formatRelativeTime(worker.lastSeenAt, now)}` : 'Never seen'}
      />
      <Stat label="Read (24h)" value={last24h.completed} />
      <Stat
        label="Failed (24h)"
        value={last24h.failed}
        note={formatOptional(last24h.failureRate, (rate) => `${Math.round(rate * 100)}% of reads`)}
      />
      <Stat label="Typical time" value={formatOptional(last24h.medianSecondsToResult, formatDuration)} note="Upload to read" />
      <Checks checks={health.checks} />
    </Card>
  );
}

/** The system's own checks as one figure: all OK, or which failed and why. Each check's detail on hover. */
function Checks({ checks }: { checks: Record<string, HealthCheckResult> }) {
  const failing = Object.entries(checks).filter(([, check]) => check.status !== 'ok');
  const detail = Object.entries(checks)
    .map(([name, check]) => `${capitalise(name)}: ${check.status === 'ok' ? `OK, ${check.latencyMs} ms` : check.error}`)
    .join('\n');
  const ok = failing.length === 0;
  return (
    <Stat
      label="Systems"
      value={
        // The circled tick or cross the checks each had on the old status page.
        <span className="inline-flex items-center gap-1.5">
          {ok ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}
          {ok ? 'All OK' : failing.length === 1 ? `${capitalise(failing[0]![0])} down` : `${failing.length} down`}
        </span>
      }
      tone={ok ? 'ok' : 'bad'}
      note={ok ? undefined : failing.map(([, check]) => check.error).join(' ')}
      title={detail}
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
