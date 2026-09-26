import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, OctagonAlert, ShieldCheck } from 'lucide-react';
import { confidenceBand, type UploadDetail } from '@label-extractor/shared';
import { OVERALL_CONFIDENCE_MEANING } from '@/components/Confidence';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Upload = Pick<UploadDetail, 'confidence' | 'fieldConfidence'>;

/**
 * How far the extraction can be trusted, as a whole:
 *   high      85%+: nothing needs a look
 *   medium    60–84%: at least one field is worth checking
 *   low       under 60%: at least one field is more likely wrong than right
 *   unscored  the extraction predates confidence scores
 * A field a person has checked or corrected counts as 100% (see overallConfidence).
 */
type OverallState = 'high' | 'medium' | 'low' | 'unscored';

function overallState({ confidence, fieldConfidence }: Upload): OverallState {
  if (!fieldConfidence || confidence === null) return 'unscored';
  return ({ ok: 'high', check: 'medium', low: 'low' } as const)[confidenceBand(confidence)];
}

const STATES: Record<OverallState, { icon: LucideIcon; bar: string; border: string; text: (score: number | null) => string }> = {
  high: {
    icon: ShieldCheck,
    bar: 'bg-success text-white',
    border: 'border-success/40',
    text: (score) => `High confidence (${score}%)`,
  },
  medium: {
    icon: AlertTriangle,
    bar: 'border-t border-warning-border bg-warning-soft text-warning',
    border: 'border-warning-border',
    text: (score) => `Medium confidence (${score}%). Check flagged fields.`,
  },
  low: {
    icon: OctagonAlert,
    bar: 'border-t border-danger-border bg-danger-soft text-danger',
    border: 'border-danger-border',
    text: (score) => `Low confidence (${score}%). Check flagged fields.`,
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
 * flagged fields to be checked, when it can't, with the button that confirms them all as right.
 */
export function ConfidenceFooter({
  upload,
  onCheck,
  checking,
}: {
  upload: Upload;
  /** Confirms the flagged fields as right; offered while any are flagged (medium or low), if given. */
  onCheck?: () => void;
  checking: boolean;
}) {
  const state = overallState(upload);
  const { icon: Icon, bar, text } = STATES[state];
  const flagged = state === 'medium' || state === 'low';
  const verdictId = useId();

  return (
    <div className={cn('flex items-center gap-2 px-6 py-3 text-sm font-medium', bar)}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <p id={verdictId} role="status" title={flagged || state === 'high' ? OVERALL_CONFIDENCE_MEANING : undefined}>
        {text(upload.confidence)}
      </p>
      {flagged && onCheck && (
        // Bold text in the footer's own colour, underlined on hover: still a button, so it spins while saving.
        // Described by the verdict beside it, which says it's the flagged fields it marks.
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-auto shrink-0 p-0 font-bold text-current hover:underline"
          aria-describedby={verdictId}
          loading={checking}
          onClick={onCheck}
        >
          Mark as checked
        </Button>
      )}
    </div>
  );
}
