import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, OctagonAlert, XCircle } from 'lucide-react';
import { confidenceBand, type UploadStatus } from '@label-extractor/shared';
import { Badge } from '@/components/ui/badge';
import { OVERALL_CONFIDENCE_MEANING } from '@/components/Confidence';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';

interface PillStyle {
  label: string;
  icon: LucideIcon;
  className: string;
  spin?: boolean;
}

const STATUS: Record<UploadStatus, PillStyle> = {
  uploading: { label: 'Uploading', icon: Loader2, spin: true, className: 'border-border bg-card text-muted-foreground' },
  queued: { label: 'Queued', icon: Clock, className: 'border-border bg-card text-muted-foreground' },
  processing: { label: 'Processing', icon: Loader2, spin: true, className: 'border-brand/25 bg-brand-soft text-brand' },
  completed: { label: 'Completed', icon: CheckCircle2, className: TONE_CLASSES.success },
  failed: { label: 'Failed', icon: XCircle, className: TONE_CLASSES.danger },
};

/** A completed upload that isn't confidently read: amber for medium confidence, red for low. */
const WORTH_CHECKING: Record<'check' | 'low', Omit<PillStyle, 'label'>> = {
  check: { icon: AlertTriangle, className: TONE_CLASSES.warning },
  low: { icon: OctagonAlert, className: TONE_CLASSES.danger },
};

/**
 * Status as a rounded pill: icon + word, never colour alone (SupplyScope's pill style). A completed
 * upload also says how confident its extraction is: a confident one is just "Completed" ("Ready",
 * while it waits in Review to be submitted), and one worth a look reads "Check (72%)" instead,
 * amber or red, so it invites a check. `confidence` is the upload's overall score (its least certain
 * unchecked field), or null when there's nothing to flag.
 */
export function StatusPill({
  status,
  confidence = null,
  inReview = false,
  className,
}: {
  status: UploadStatus;
  confidence?: number | null;
  /** Read, but not yet submitted to Products. */
  inReview?: boolean;
  className?: string;
}) {
  const band = status === 'completed' && confidence !== null ? confidenceBand(confidence) : 'ok';
  const { icon: Icon, className: tone, spin } = band === 'ok' ? STATUS[status] : WORTH_CHECKING[band];
  const label = inReview && status === 'completed' ? 'Ready' : STATUS[status].label;
  return (
    <Badge
      variant="outline"
      className={cn('h-6 gap-1 rounded-full px-2.5 font-medium', tone, className)}
      title={band === 'ok' ? undefined : OVERALL_CONFIDENCE_MEANING}
    >
      <Icon aria-hidden className={cn(spin && 'animate-spin motion-reduce:animate-none')} />
      {band === 'ok' ? (
        label
      ) : (
        <>
          <span className="sr-only">Completed, confidence {confidence}%: </span>
          Check<span aria-hidden> ({confidence}%)</span>
        </>
      )}
    </Badge>
  );
}
