import { describe, expect, it } from 'vitest';
import type { ExtractionConfidence, LabelExtraction } from '@label-extractor/shared';
import { applyConfidenceChecks } from '../../src/extraction/confidence-checks.ts';
import { SAMPLE_EXTRACTION } from '../fakes.ts';

/** The model is sure of everything, so any lowered score comes from a check. */
const SURE: ExtractionConfidence = {
  productName: { score: 95, reasons: [] },
  brand: { score: 95, reasons: [] },
  netWeight: { score: 95, reasons: [] },
  allergens: { score: 95, reasons: [] },
  ingredients: { score: 95, reasons: [] },
};

const check = (changes: Partial<LabelExtraction>, confidence = SURE) =>
  applyConfidenceChecks({ ...SAMPLE_EXTRACTION, ...changes }, confidence);

describe('applyConfidenceChecks', () => {
  it('leaves scores alone when the data agrees with itself', () => {
    expect(check({})).toEqual(SURE);
  });

  describe('net weight', () => {
    it.each(['Net Wt 16 oz (454 g)', 'NET 454G', 'Poids net 454,0 g'])('finds 454 in "%s"', (text) => {
      expect(check({ netWeight: { value: 454, unit: 'g', text } }).netWeight).toEqual(SURE.netWeight);
    });

    it('caps the score when the amount is not in the printed text', () => {
      expect(check({ netWeight: { value: 500, unit: 'g', text: 'Net Wt 16 oz (454 g)' } }).netWeight).toEqual({
        score: 60,
        reasons: ["The amount isn't in the printed net quantity."],
      });
    });
  });

  it('caps allergens when a declared allergen is in no ingredient', () => {
    expect(check({ allergens: ['oats', 'pecans', 'milk', 'soy'] }).allergens).toEqual({
      score: 60,
      reasons: ['No ingredient contains milk or soy.'],
    });
  });

  it('caps ingredients when the printed percentages add up to more than 100%', () => {
    const ingredients = [
      { name: 'Oats', percent: 70, subIngredients: [], allergens: [] },
      { name: 'Pecans', percent: 45, subIngredients: [], allergens: [] },
    ];
    expect(check({ ingredients, allergens: [] }).ingredients).toEqual({
      score: 60,
      reasons: ['The percentages add up to 115%.'],
    });
  });

  it('keeps a lower score from the model, adding the check reason to the model reason', () => {
    const doubtful = { ...SURE, netWeight: { score: 40, reasons: ['Partly hidden by a fold.'] } };
    expect(check({ netWeight: { value: 500, unit: 'g', text: '454 g' } }, doubtful).netWeight).toEqual({
      score: 40,
      reasons: ['Partly hidden by a fold.', "The amount isn't in the printed net quantity."],
    });
  });
});
