import { CONFIDENT_SCORE, confidenceBand, type ConfidenceBand } from '@label-extractor/shared';
import { BAND_TONE, TONE_DOT_CLASSES, TONE_TEXT_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';

/**
 * How confidence looks. The band decides it, not the exact number: a model's own score ranks
 * fields well but isn't a calibrated probability (see shared/src/confidence.ts). It's plain text,
 * never a pill: quiet grey when nothing needs attention, amber or red (BAND_TONE) when something
 * does, and said as much to screen readers.
 */
const SPOKEN: Record<ConfidenceBand, string> = { ok: '', check: ', worth checking', low: ', low' };

function bandTextClass(band: ConfidenceBand): string {
  const tone = BAND_TONE[band];
  return tone ? cn('font-medium', TONE_TEXT_CLASSES[tone]) : TONE_TEXT_CLASSES.muted;
}

const MEANING = `How likely it is that this was read correctly. Below ${CONFIDENT_SCORE}% it's worth checking.`;

/**
 * The colour of a field's marker dot: amber or red by band, and green when there's nothing to
 * flag (a confident score, or none at all).
 */
export function confidenceDotClass(score: number | null): string {
  const tone = score === null ? null : BAND_TONE[confidenceBand(score)];
  return TONE_DOT_CLASSES[tone ?? 'success'];
}

/**
 * A score, as just the number: "95%". What it is shows on hover, and is read out to screen readers
 * ("Confidence 95%").
 */
export function ConfidenceScore({ score }: { score: number }) {
  const band = confidenceBand(score);
  return (
    <span className={cn('shrink-0 text-xs whitespace-nowrap tabular-nums', bandTextClass(band))} title={MEANING}>
      <span className="sr-only">Confidence </span>
      {score}%{SPOKEN[band] && <span className="sr-only">{SPOKEN[band]}</span>}
    </span>
  );
}

/** What an upload's overall score is, for the tooltips that show it. */
export const OVERALL_CONFIDENCE_MEANING = `The upload's confidence is its least certain field; one a person has checked counts as 100%. ${MEANING}`;
