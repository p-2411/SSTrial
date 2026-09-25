import { CheckCircle2, XCircle } from 'lucide-react';
import type { HealthCheckResult } from '@label-extractor/shared';
import { cn } from '@/lib/utils';
import { SectionCard } from './SectionCard';

export function HealthChecksCard({ checks }: { checks: Record<string, HealthCheckResult> }) {
  return (
    <SectionCard title="Health checks" description="The API's own dependencies, checked on every refresh.">
      <ul className="grid gap-2">
        {Object.entries(checks).map(([name, check]) => (
          <HealthRow key={name} name={name} check={check} />
        ))}
      </ul>
    </SectionCard>
  );
}

/** A passing check shows how fast it answered; a failing one says what went wrong. */
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
