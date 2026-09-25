import { describe, expect, it } from 'vitest';
import { isEmptyExtraction, labelExtractionSchema } from '../src/extraction.ts';

const valid = {
  productName: 'Crunchy Peanut Butter',
  brand: 'Nutty Co',
  ingredients: [
    { name: 'Peanuts', percent: 98, subIngredients: [], allergens: ['peanuts'] },
    { name: 'Salt', percent: null, subIngredients: [], allergens: [] },
  ],
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
      ingredients: [
        { name: ' Peanuts ', percent: null, subIngredients: [], allergens: ['PEANUTS'] },
        { name: 'peanuts', percent: null, subIngredients: [], allergens: [] }, // repeat
        { name: 'Puffed rice', percent: null, subIngredients: ['rice', ' ', 'Rice', 'salt'], allergens: [] },
      ],
      allergens: ['Peanuts', 'PEANUTS', 'Soy'],
      netWeight: null,
    });
    expect(parsed).toEqual({
      productName: 'Crunchy Peanut Butter',
      brand: null,
      ingredients: [
        { name: 'Peanuts', percent: null, subIngredients: [], allergens: ['peanuts'] },
        { name: 'Puffed rice', percent: null, subIngredients: ['rice', 'salt'], allergens: [] },
      ],
      allergens: ['peanuts', 'soy'],
      netWeight: null,
    });
  });

  it('only links an ingredient to allergens the label declares', () => {
    const parsed = labelExtractionSchema.parse({
      ...valid,
      ingredients: [{ name: 'Wheat flakes', percent: null, subIngredients: [], allergens: ['wheat', 'gluten'] }],
      allergens: ['gluten'],
    });
    expect(parsed.ingredients[0]?.allergens).toEqual(['gluten']);
  });

  it('still reads results stored before ingredients were structured', () => {
    const parsed = labelExtractionSchema.parse({ ...valid, ingredients: ['Rolled OATS (48%)', ' ', 'Salt'] });
    expect(parsed.ingredients).toEqual([
      { name: 'Rolled OATS (48%)', percent: null, subIngredients: [], allergens: [] },
      { name: 'Salt', percent: null, subIngredients: [], allergens: [] },
    ]);
  });

  it.each([
    ['a missing field', { ...valid, brand: undefined }],
    ['a wrong type', { ...valid, ingredients: 'Peanuts, Salt' }],
    ['an impossible percentage', { ...valid, ingredients: [{ ...valid.ingredients[0], percent: 140 }] }],
    ['an ingredient without a name', { ...valid, ingredients: [{ ...valid.ingredients[0], name: '  ' }] }],
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
