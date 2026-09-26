import { CONFIDENT_SCORE, confidenceBand, type ConfidenceBand } from '@label-extractor/shared';
import { TONE_DOT_CLASSES, type Tone } from '@/lib/tone';
import { cn } from '@/lib/utils';

/**
 * How confidence looks. The band decides it, not the exact number: a model's own score ranks
 * fields well but isn't a calibrated probability (see shared/src/confidence.ts). It's plain text,
 * never a pill: quiet grey when nothing needs attention, amber or red when something does.
 */
const BANDS: Record<ConfidenceBand, { tone: Tone | null; text: string; spoken: string }> = {
  ok: { tone: null, text: 'text-muted-foreground', spoken: '' },
  check: { tone: 'warning', text: 'font-medium text-warning', spoken: ', worth checking' },
  low: { tone: 'danger', text: 'font-medium text-danger', spoken: ', low' },
};

const MEANING = `How sure the AI is that it read this correctly. Below ${CONFIDENT_SCORE}% it's worth checking.`;

/**
 * The colour of a field's marker dot: amber or red by band, and green when there's nothing to
 * flag (a confident score, or none at all).
 */
export function confidenceDotClass(score: number | null): string {
  const tone = score === null ? null : BANDS[confidenceBand(score)].tone;
  return TONE_DOT_CLASSES[tone ?? 'success'];
}

/**
 * A score: "95%", with what it means on hover. Where scores repeat (a field each), the page says
 * once that they're confidence; `spelledOut` says it on the score itself ("95% confident"), for
 * where it stands alone.
 */
export function ConfidenceScore({
  score,
  spelledOut = false,
  title = MEANING,
  className,
}: {
  score: number;
  spelledOut?: boolean;
  title?: string;
  className?: string;
}) {
  const band = BANDS[confidenceBand(score)];
  return (
    <span className={cn('shrink-0 text-xs whitespace-nowrap tabular-nums', band.text, className)} title={title}>
      {!spelledOut && <span className="sr-only">Confidence </span>}
      {score}%{spelledOut && ' confident'}
      {band.spoken && <span className="sr-only">{band.spoken}</span>}
    </span>
  );
}

/** How an upload's overall score is worked out, for its tooltip. */
export const OVERALL_MEANING = `The least certain field nobody has checked yet. ${MEANING}`;

/**
 * An upload's overall score in the list, where it stands alone: "72% confident". Nothing when
 * there's no score (never scored, or every field reviewed).
 */
export function UploadConfidence({ score }: { score: number | null }) {
  return score === null ? null : <ConfidenceScore score={score} spelledOut title={OVERALL_MEANING} />;
}
