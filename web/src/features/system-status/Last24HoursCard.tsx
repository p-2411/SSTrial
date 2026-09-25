import type { ReactNode } from 'react';
import type { OpsStatusResponse } from '@label-extractor/shared';
import { formatDuration, formatOptional } from '@/lib/format';
import { SectionCard } from './SectionCard';

export function Last24HoursCard({ last24h }: { last24h: OpsStatusResponse['last24h'] }) {
  return (
    <SectionCard title="Last 24 hours" description="Uploads that finished, and how long they took.">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Fact label="Completed">{last24h.completed}</Fact>
        <Fact label="Failed">{last24h.failed}</Fact>
        <Fact label="Failure rate">{formatOptional(last24h.failureRate, (rate) => `${Math.round(rate * 100)}%`)}</Fact>
        <Fact label="Median time to result">{formatOptional(last24h.medianSecondsToResult, formatDuration)}</Fact>
      </dl>
    </SectionCard>
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
