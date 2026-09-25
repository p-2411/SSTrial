/**
 * How sure the extraction is of each field, out of 100. The model scores each field as it reads
 * the label; code checks then cap a score where the data contradicts itself (server/src/extraction/
 * confidence-checks.ts). A model's own score ranks fields well but isn't a calibrated probability,
 * so the UI works in bands rather than exact numbers.
 *
 * Zod-free, like units.ts: the web app imports it.
 */

export const CONFIDENCE_FIELDS = ['productName', 'brand', 'netWeight', 'allergens', 'ingredients'] as const;
export type ConfidenceField = (typeof CONFIDENCE_FIELDS)[number];

export interface FieldConfidence {
  /** 0–100. */
  score: number;
  /** Why it isn't higher, when it isn't: the model's reason and any failed checks. */
  reasons: string[];
}

export type ExtractionConfidence = Record<ConfidenceField, FieldConfidence>;

/** At or above this, a field needs no attention. */
export const CONFIDENT_SCORE = 85;
/** Below this, a field is more likely wrong than right. Failed checks cap scores here. */
export const DOUBTFUL_SCORE = 60;

export type ConfidenceBand = 'ok' | 'check' | 'low';

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= CONFIDENT_SCORE) return 'ok';
  return score >= DOUBTFUL_SCORE ? 'check' : 'low';
}

/**
 * The upload's score: its least certain field, because one doubtful field is what makes a label
 * need review (an average would let four good fields hide a bad one). Fields a person has already
 * reviewed don't count; with none left, or no scores at all, there's nothing to say.
 */
export function overallConfidence(
  confidence: ExtractionConfidence | null,
  reviewed: readonly ConfidenceField[] = [],
): number | null {
  if (!confidence) return null;
  const scores = CONFIDENCE_FIELDS.filter((field) => !reviewed.includes(field)).map((field) => confidence[field].score);
  return scores.length > 0 ? Math.min(...scores) : null;
}
