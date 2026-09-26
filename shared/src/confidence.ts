import type { LabelExtraction } from './extraction.ts';
import { LABEL_FIELDS, type LabelField } from './fields.ts';
import { formatList } from './text.ts';
import { textShowsAmount } from './units.ts';

/**
 * How sure the extraction is of each field, out of 100. The model scores each field as it reads
 * the label, and that is what's stored. Checks against the data itself (applyConfidenceChecks)
 * are applied whenever it's read, so they always describe the data as it is now, edits included.
 * A model's own score ranks fields well but isn't a calibrated probability, so the UI works in
 * bands rather than exact numbers.
 *
 * Zod-free, like units.ts: the web app imports it.
 */

export interface FieldConfidence {
  /** 0–100. */
  score: number;
  /** Why it isn't higher, when it isn't: the model's reason and any failed checks. */
  reasons: string[];
}

export type ExtractionConfidence = Record<LabelField, FieldConfidence>;

/** At or above this, a field needs no attention. */
export const CONFIDENT_SCORE = 85;
/** Below this, a field is more likely wrong than right. Failed checks cap scores here. */
export const DOUBTFUL_SCORE = 60;

export type ConfidenceBand = 'ok' | 'check' | 'low';

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= CONFIDENT_SCORE) return 'ok';
  return score >= DOUBTFUL_SCORE ? 'check' : 'low';
}

/** Whether a field with this score should be looked at by a person (unless someone already has). */
export function needsChecking(score: number): boolean {
  return confidenceBand(score) !== 'ok';
}

/** A field a person has checked, or corrected: as certain as it gets. */
export const REVIEWED_SCORE = 100;

/**
 * The upload's score: its least certain field, because one doubtful field is what makes a label
 * need review (an average would let four good fields hide a bad one). A field a person has checked
 * or corrected counts as certain (REVIEWED_SCORE). Null when nothing was scored.
 */
export function overallConfidence(
  confidence: ExtractionConfidence | null,
  reviewed: readonly LabelField[] = [],
): number | null {
  if (!confidence) return null;
  return Math.min(...LABEL_FIELDS.map((field) => (reviewed.includes(field) ? REVIEWED_SCORE : confidence[field].score)));
}

/**
 * The fields worth a person's look: scored below confident, and not yet edited or checked by anyone.
 * What "Mark as checked" confirms, and what must be checked before an upload can be submitted.
 */
export function flaggedFields(confidence: ExtractionConfidence | null, reviewed: readonly LabelField[]): LabelField[] {
  if (!confidence) return [];
  return LABEL_FIELDS.filter((field) => !reviewed.includes(field) && needsChecking(confidence[field].score));
}

/**
 * Checks that catch the model being confidently wrong: where the data contradicts itself, that
 * field's score is capped at DOUBTFUL_SCORE and the reason added. Checks only ever lower a score,
 * and the model's own reason for a low score is kept. Safe to apply more than once.
 */
export function applyConfidenceChecks(result: LabelExtraction, confidence: ExtractionConfidence): ExtractionConfidence {
  const checked = Object.fromEntries(
    LABEL_FIELDS.map((field) => [field, { score: confidence[field].score, reasons: [...confidence[field].reasons] }]),
  ) as ExtractionConfidence;
  const flag = (field: LabelField, reason: string) => {
    checked[field].score = Math.min(checked[field].score, DOUBTFUL_SCORE);
    if (!checked[field].reasons.includes(reason)) checked[field].reasons.push(reason);
  };

  // The amount is copied from the printed statement, so it should appear in it.
  if (result.netWeight && !textShowsAmount(result.netWeight.text, result.netWeight.value)) {
    flag('netWeight', "The amount isn't in the printed net quantity.");
  }

  // Each declared allergen should come from somewhere in the ingredient list.
  if (result.ingredients.length > 0) {
    const inIngredients = new Set(result.ingredients.flatMap((ingredient) => ingredient.allergens));
    const unexplained = result.allergens.filter((allergen) => !inIngredients.has(allergen));
    if (unexplained.length > 0) flag('allergens', `No ingredient contains ${formatList(unexplained)}.`);
  }

  // Printed percentages are each rounded, so allow a little over 100 before calling it a misreading.
  const total = result.ingredients.reduce((sum, ingredient) => sum + (ingredient.percent ?? 0), 0);
  if (total > 100.5) flag('ingredients', `The percentages add up to ${Math.round(total * 10) / 10}%.`);

  return checked;
}
