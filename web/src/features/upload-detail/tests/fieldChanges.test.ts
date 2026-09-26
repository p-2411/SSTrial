import { describe, expect, it } from 'vitest';
import type { Ingredient } from '@label-extractor/shared';
import {
  addAllergen,
  allergensChanges,
  ingredientDrafts,
  ingredientsChanges,
  netWeightChanges,
  textChanges,
} from '../fieldChanges.ts';

describe('textChanges', () => {
  it('trims the text, and treats an empty one as not on the label', () => {
    expect(textChanges('brand', '  Hearth & Co ')).toEqual({ brand: 'Hearth & Co' });
    expect(textChanges('productName', '   ')).toEqual({ productName: null });
  });
});

describe('netWeightChanges', () => {
  it('reads the amount as a number, and no amount as none on the label', () => {
    expect(netWeightChanges('1.5', 'kg')).toEqual({ netWeight: { value: 1.5, unit: 'kg' } });
    expect(netWeightChanges(' ', 'g')).toEqual({ netWeight: null });
  });
});

describe('addAllergen', () => {
  it('adds what was typed as the server stores it, once', () => {
    expect(addAllergen(['oats'], ' Milk ')).toEqual(['oats', 'milk']);
    expect(addAllergen(['oats'], 'OATS')).toEqual(['oats']);
    expect(addAllergen(['oats'], '  ')).toEqual(['oats']);
  });
});

describe('allergensChanges', () => {
  it('counts an allergen still typed in the box rather than dropping it', () => {
    expect(allergensChanges(['oats'], 'Milk')).toEqual({ allergens: ['oats', 'milk'] });
    expect(allergensChanges([], '')).toEqual({ allergens: [] });
  });
});

describe('ingredientsChanges', () => {
  const oats: Ingredient = { name: 'Rolled oats', percent: 48, subIngredients: [], allergens: ['oats'] };

  it('round-trips unedited rows unchanged', () => {
    expect(ingredientsChanges(ingredientDrafts([oats]))).toEqual({ ingredients: [oats] });
  });

  it('trims names, reads percentages, and drops rows left without a name', () => {
    const blank: Ingredient = { name: '', percent: null, subIngredients: [], allergens: [] };
    expect(
      ingredientsChanges([
        { ingredient: { ...oats, name: ' Oat flakes ' }, percent: '' },
        { ingredient: blank, percent: '5' },
        { ingredient: { ...blank, name: 'Sea salt' }, percent: '1.5' },
      ]),
    ).toEqual({
      ingredients: [
        { name: 'Oat flakes', percent: null, subIngredients: [], allergens: ['oats'] },
        { name: 'Sea salt', percent: 1.5, subIngredients: [], allergens: [] },
      ],
    });
  });
});
