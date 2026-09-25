import type { ReactNode } from 'react';
import type { OpsStatusResponse } from '@label-extractor/shared';
import { Card } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface QueueStatsProps {
  queue: OpsStatusResponse['queue'];
  worker: OpsStatusResponse['worker'];
  now: number;
}

/** Is work flowing? A row of big numbers: what's queued, what's running, and whether the worker is. */
export function QueueStats({ queue, worker, now }: QueueStatsProps) {
  return (
    <section aria-label="Queue" className="grid grid-cols-4 gap-4">
      <Stat label="Waiting" value={queue.waiting} />
      <Stat label="Retrying" value={queue.retrying} />
      <Stat label="Processing" value={queue.processing} />
      <Stat
        label="Worker"
        value={worker.healthy ? 'Running' : 'Not reporting'}
        tone={worker.healthy ? 'ok' : 'bad'}
        note={worker.lastSeenAt ? `Last seen ${formatRelativeTime(worker.lastSeenAt, now)}` : 'Never seen'}
      />
    </section>
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
