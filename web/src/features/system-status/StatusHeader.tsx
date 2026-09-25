import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';
import { OPS_REFRESH_MS } from '@/api/queries';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/format';
import { TONE_CLASSES, type Tone } from '@/lib/tone';
import { cn } from '@/lib/utils';
import type { OverallState } from './systemState';

/** The page title, how fresh the data is, and the one-line verdict. */
export function StatusHeader({ generatedAt, state, now }: { generatedAt: string; state: OverallState; now: number }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold">System status</h2>
        <p className="text-sm text-muted-foreground">
          Updated <time dateTime={generatedAt}>{formatRelativeTime(generatedAt, now)}</time>. Refreshes every{' '}
          {OPS_REFRESH_MS / 1000} seconds.
        </p>
      </div>
      <OverallPill state={state} />
    </header>
  );
}

const OVERALL: Record<OverallState, { label: string; icon: LucideIcon; tone: Tone }> = {
  ok: { label: 'All systems working', icon: CheckCircle2, tone: 'success' },
  degraded: { label: 'Needs attention', icon: AlertTriangle, tone: 'warning' },
  down: { label: 'Something is broken', icon: OctagonAlert, tone: 'danger' },
};

function OverallPill({ state }: { state: OverallState }) {
  const { label, icon: Icon, tone } = OVERALL[state];
  return (
    <Badge variant="outline" role="status" className={cn('h-8 gap-1.5 rounded-full px-3 text-sm', TONE_CLASSES[tone])}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
