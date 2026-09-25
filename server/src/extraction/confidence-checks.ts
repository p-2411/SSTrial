import { DOUBTFUL_SCORE, type ConfidenceField, type ExtractionConfidence, type LabelExtraction } from '@label-extractor/shared';

/**
 * Plain checks that catch the model being confidently wrong: where the extracted data contradicts
 * itself, that field's score is capped at DOUBTFUL_SCORE and the reason added. Checks only ever
 * lower a score; the model's own reason for a low score is kept.
 */
export function applyConfidenceChecks(result: LabelExtraction, confidence: ExtractionConfidence): ExtractionConfidence {
  const checked: ExtractionConfidence = structuredClone(confidence);
  const flag = (field: ConfidenceField, reason: string) => {
    checked[field].score = Math.min(checked[field].score, DOUBTFUL_SCORE);
    checked[field].reasons.push(reason);
  };

  // The amount is copied from the printed statement, so it should appear in it.
  if (result.netWeight && !numbersIn(result.netWeight.text).some((n) => Math.abs(n - result.netWeight!.value) < 1e-9)) {
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

/** Every number written in the text, reading "454,0" (decimal comma) as 454. */
function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
}

function formatList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}
