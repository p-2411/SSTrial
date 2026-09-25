import { confidenceBand, type ConfidenceBand } from '@label-extractor/shared';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';

/**
 * How confidence looks. The band decides it, not the exact number: a model's own score ranks
 * fields well but isn't a calibrated probability (see shared/src/confidence.ts).
 */
const BANDS: Record<ConfidenceBand, { word: string | null; spoken: string; pill: string; dot: string }> = {
  ok: { word: null, spoken: '', pill: 'border-transparent text-muted-foreground', dot: 'bg-success' },
  check: { word: 'Check', spoken: ', check this field', pill: TONE_CLASSES.warning, dot: 'bg-warning-border' },
  low: { word: 'Low', spoken: ', low', pill: TONE_CLASSES.danger, dot: 'bg-danger' },
};

const pill = 'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums';

/** The colour of a field's marker dot: green, amber or red by band; green when it wasn't scored. */
export function confidenceDotClass(score: number | null): string {
  return score === null ? BANDS.ok.dot : BANDS[confidenceBand(score)].dot;
}

/** One field's score: quiet when it's fine, a labelled amber or red pill when it needs a look. */
export function ConfidenceScore({ score }: { score: number }) {
  const band = BANDS[confidenceBand(score)];
  return (
    <span className={cn(pill, band.pill)}>
      <span className="sr-only">
        Confidence {score} out of 100{band.spoken}
      </span>
      <span aria-hidden>{band.word ? `${band.word} ${score}` : score}</span>
    </span>
  );
}

/** An upload's overall score in the list, shown only when some field needs checking. */
export function UploadConfidence({ score }: { score: number | null }) {
  if (score === null) return null;
  const band = confidenceBand(score);
  if (band === 'ok') return null;
  return <span className={cn(pill, BANDS[band].pill)}>Confidence {score}</span>;
}
