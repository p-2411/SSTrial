import type { AlertSeverity, OpsAlert, OpsStatusResponse } from '@label-extractor/shared';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatDuration, formatRelativeTime } from '@/lib/format';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { SectionCard } from './SectionCard';
import { SEVERITY_TONE } from './systemState';

/** Open alerts first, then recently resolved ones. */
export function AlertLogCard({ alerts, now }: { alerts: OpsStatusResponse['alerts']; now: number }) {
  return (
    <SectionCard title="Alert log" description="Checked every minute. An alert stays open until its problem clears.">
      {alerts.open.length === 0 && alerts.recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alerts yet.</p>
      ) : (
        <ul className="grid gap-2">
          {[...alerts.open, ...alerts.recent].map((alert) => (
            <AlertRow key={alert.id} alert={alert} now={now} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: 'Critical', warning: 'Warning' };

function AlertRow({ alert, now }: { alert: OpsAlert; now: number }) {
  const open = alert.resolvedAt === null;
  return (
    <li className={cn('grid gap-1 rounded-lg border px-4 py-3', open ? 'bg-card' : 'bg-muted/40 text-muted-foreground')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn('rounded-full', open ? TONE_CLASSES[SEVERITY_TONE[alert.severity]] : 'border-border text-muted-foreground')}
        >
          {open ? SEVERITY_LABEL[alert.severity] : 'Resolved'}
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
