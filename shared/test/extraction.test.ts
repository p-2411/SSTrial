import { describe, expect, it } from 'vitest';
import { isEmptyExtraction, labelExtractionSchema } from '../src/extraction.ts';

const valid = {
  productName: 'Crunchy Peanut Butter',
  brand: 'Nutty Co',
  ingredients: ['Peanuts (98%)', 'Salt'],
  allergens: ['Peanuts'],
  netWeight: { value: 375, unit: 'g', text: 'Net Wt 375g' },
};

describe('labelExtractionSchema', () => {
  it('accepts a well-formed extraction', () => {
    expect(labelExtractionSchema.parse(valid)).toEqual({ ...valid, allergens: ['peanuts'] });
  });

  it('normalises cosmetic noise instead of rejecting it', () => {
    const parsed = labelExtractionSchema.parse({
      productName: '  Crunchy   Peanut Butter ',
      brand: '', // models often send "" for "unknown"
      ingredients: ['Peanuts', ' ', 'peanuts', 'Salt'],
      allergens: ['Peanuts', 'PEANUTS', 'Soy'],
      netWeight: null,
    });
    expect(parsed).toEqual({
      productName: 'Crunchy Peanut Butter',
      brand: null,
      ingredients: ['Peanuts', 'Salt'],
      allergens: ['peanuts', 'soy'],
      netWeight: null,
    });
  });

  it.each([
    ['a missing field', { ...valid, brand: undefined }],
    ['a wrong type', { ...valid, ingredients: 'Peanuts, Salt' }],
    ['an unknown unit', { ...valid, netWeight: { value: 1, unit: 'stone', text: '1 stone' } }],
    ['a non-positive quantity', { ...valid, netWeight: { value: -5, unit: 'g', text: '-5g' } }],
    ['runaway text', { ...valid, productName: 'x'.repeat(1000) }],
    ['too many list items', { ...valid, ingredients: Array.from({ length: 500 }, (_, i) => `item ${i}`) }],
  ])('rejects %s', (_label, input) => {
    expect(labelExtractionSchema.safeParse(input).success).toBe(false);
  });
});

describe('isEmptyExtraction', () => {
  it('is true only when nothing at all was found', () => {
    const empty = labelExtractionSchema.parse({ productName: null, brand: null, ingredients: [], allergens: [], netWeight: null });
    expect(isEmptyExtraction(empty)).toBe(true);
    expect(isEmptyExtraction({ ...empty, brand: 'Nutty Co' })).toBe(false);
  });
});
