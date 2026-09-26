import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, OctagonAlert, ShieldCheck } from 'lucide-react';
import { confidenceBand, type UploadDetail } from '@label-extractor/shared';
import { OVERALL_CONFIDENCE_MEANING } from '@/components/Confidence';
import { cn } from '@/lib/utils';

type Upload = Pick<UploadDetail, 'confidence' | 'fieldConfidence'>;

/**
 * How far the extraction can be trusted, as a whole:
 *   high      85%+: nothing needs a look
 *   medium    60–84%: at least one field is worth checking
 *   low       under 60%: at least one field is more likely wrong than right
 *   reviewed  every field was scored, and a person has edited or checked every one
 *   unscored  the extraction predates confidence scores
 */
type OverallState = 'high' | 'medium' | 'low' | 'reviewed' | 'unscored';

function overallState({ confidence, fieldConfidence }: Upload): OverallState {
  if (!fieldConfidence) return 'unscored';
  if (confidence === null) return 'reviewed';
  return ({ ok: 'high', check: 'medium', low: 'low' } as const)[confidenceBand(confidence)];
}

const STATES: Record<OverallState, { icon: LucideIcon; bar: string; border: string; text: (score: number | null) => string }> = {
  high: {
    icon: ShieldCheck,
    bar: 'bg-success text-white',
    border: 'border-success/40',
    text: (score) => `High confidence · ${score}%`,
  },
  medium: {
    icon: AlertTriangle,
    bar: 'border-t border-warning-border bg-warning-soft text-warning',
    border: 'border-warning-border',
    text: (score) => `Medium confidence · ${score}%. Check the flagged fields.`,
  },
  low: {
    icon: OctagonAlert,
    bar: 'border-t border-danger-border bg-danger-soft text-danger',
    border: 'border-danger-border',
    text: (score) => `Low confidence · ${score}%. Check the flagged fields.`,
  },
  reviewed: {
    icon: ShieldCheck,
    bar: 'bg-success text-white',
    border: 'border-success/40',
    text: () => 'Every field checked by a person',
  },
  // Every stored result passed schema validation, so without scores that's what there is to say.
  unscored: {
    icon: ShieldCheck,
    bar: 'bg-success text-white',
    border: 'border-success/40',
    text: () => 'Validated against the label schema',
  },
};

/** The card's border, in the colour of its footer. */
export function confidenceBorderClass(upload: Upload): string {
  return STATES[overallState(upload)].border;
}

/**
 * The Product information card's footer: the upload's overall confidence, as a verdict. Green when
 * it can be trusted as it is, like SupplyScope's "verified" footer; amber or red, asking for the
 * flagged fields to be checked, when it can't.
 */
export function ConfidenceFooter({ upload }: { upload: Upload }) {
  const state = overallState(upload);
  const { icon: Icon, bar, text } = STATES[state];
  return (
    <div
      role="status"
      className={cn('flex items-center gap-2 px-6 py-3 text-sm font-medium', bar)}
      title={state === 'high' || state === 'medium' || state === 'low' ? OVERALL_CONFIDENCE_MEANING : undefined}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {text(upload.confidence)}
    </div>
  );
}
