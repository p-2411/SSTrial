import { describe, expect, it } from 'vitest';
import { confidenceBand, overallConfidence, type ExtractionConfidence } from '../src/confidence.ts';

const scores = (productName: number, brand = 95, netWeight = 95, allergens = 95, ingredients = 95): ExtractionConfidence => ({
  productName: { score: productName, reasons: [] },
  brand: { score: brand, reasons: [] },
  netWeight: { score: netWeight, reasons: [] },
  allergens: { score: allergens, reasons: [] },
  ingredients: { score: ingredients, reasons: [] },
});

describe('confidenceBand', () => {
  it.each([
    [100, 'ok'],
    [85, 'ok'],
    [84, 'check'],
    [60, 'check'],
    [59, 'low'],
    [0, 'low'],
  ] as const)('puts %i in %s', (score, band) => {
    expect(confidenceBand(score)).toBe(band);
  });
});

describe('overallConfidence', () => {
  it('is the lowest field score: one doubtful field is what makes a label need review', () => {
    expect(overallConfidence(scores(92, 88, 40, 97, 91))).toBe(40);
  });

  it('leaves out fields a person has already reviewed', () => {
    expect(overallConfidence(scores(92, 88, 40, 97, 91), ['netWeight'])).toBe(88);
  });

  it('has nothing to say once every field is reviewed, or when nothing was scored', () => {
    expect(overallConfidence(scores(50), ['productName', 'brand', 'netWeight', 'allergens', 'ingredients'])).toBeNull();
    expect(overallConfidence(null)).toBeNull();
  });
});
