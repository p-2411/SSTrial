import type { OpsStatusResponse } from '@label-extractor/shared';
import { SectionCard } from './SectionCard';

export function FailuresByReasonCard({ failures }: { failures: OpsStatusResponse['failuresByReason'] }) {
  return (
    <SectionCard title="Failures by reason" description="Uploads that failed in the last 24 hours.">
      {failures.length === 0 ? (
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
            {failures.map((row) => (
              <tr key={row.code} className="border-t">
                <td className="py-2 pr-4">{row.message}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{row.code}</td>
                <td className="py-2 text-right tabular-nums">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}
