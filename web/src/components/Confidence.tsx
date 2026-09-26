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

/** A score, saying what it is: "95% confident", with what that means on hover. */
export function ConfidenceScore({ score, className }: { score: number; className?: string }) {
  const band = BANDS[confidenceBand(score)];
  return (
    <span className={cn('shrink-0 text-xs whitespace-nowrap tabular-nums', band.text, className)} title={MEANING}>
      {score}% confident
      {band.spoken && <span className="sr-only">{band.spoken}</span>}
    </span>
  );
}

/**
 * An upload's overall score in the list: its least certain field that nobody has reviewed yet.
 * Nothing when there's no score (never scored, or every field reviewed).
 */
export function UploadConfidence({ score }: { score: number | null }) {
  return score === null ? null : <ConfidenceScore score={score} />;
}
