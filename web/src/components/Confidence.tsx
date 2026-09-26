import { confidenceBand, needsChecking, type ConfidenceBand } from '@label-extractor/shared';
import { TONE_CLASSES, TONE_DOT_CLASSES, type Tone } from '@/lib/tone';
import { cn } from '@/lib/utils';

/**
 * How confidence looks. The band decides it, not the exact number: a model's own score ranks
 * fields well but isn't a calibrated probability (see shared/src/confidence.ts). A band with no
 * tone needs no attention, so its score stays quiet.
 */
const BANDS: Record<ConfidenceBand, { word: string | null; spoken: string; tone: Tone | null }> = {
  ok: { word: null, spoken: '', tone: null },
  check: { word: 'Check', spoken: ', check this field', tone: 'warning' },
  low: { word: 'Low', spoken: ', low', tone: 'danger' },
};

const pill = 'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums';

function pillClass(score: number): string {
  const { tone } = BANDS[confidenceBand(score)];
  return cn(pill, tone ? TONE_CLASSES[tone] : 'border-transparent text-muted-foreground');
}

/**
 * The colour of a field's marker dot: amber or red by band, and green when there's nothing to
 * flag (a confident score, or none at all).
 */
export function confidenceDotClass(score: number | null): string {
  const tone = score === null ? null : BANDS[confidenceBand(score)].tone;
  return TONE_DOT_CLASSES[tone ?? 'success'];
}

/** One field's score: quiet when it's fine, a labelled amber or red pill when it needs a look. */
export function ConfidenceScore({ score }: { score: number }) {
  const band = BANDS[confidenceBand(score)];
  return (
    <span className={pillClass(score)}>
      <span className="sr-only">
        Confidence {score} out of 100{band.spoken}
      </span>
      <span aria-hidden>{band.word ? `${band.word} ${score}` : score}</span>
    </span>
  );
}

/** An upload's overall score in the list, shown only when some field needs checking. */
export function UploadConfidence({ score }: { score: number | null }) {
  if (score === null || !needsChecking(score)) return null;
  return <span className={pillClass(score)}>Confidence {score}</span>;
}
