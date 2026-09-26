import type { Ingredient, NetQuantityUnit, ResultChanges } from '@label-extractor/shared';

/**
 * What the field editors send: each turns its draft (what the person typed) into a change for
 * PATCH …/result. Only light tidying happens here; the server validates and normalises the whole
 * result, the same way it does model output.
 */

/** Product name or brand. Emptied means the label doesn't show one. */
export function textChanges(field: 'productName' | 'brand', text: string): ResultChanges {
  return { [field]: text.trim() || null };
}

/** Amount and unit; the server keeps the printed wording if it states this amount. No amount means none on the label. */
export function netWeightChanges(amount: string, unit: NetQuantityUnit): ResultChanges {
  return { netWeight: amount.trim() === '' ? null : { value: Number(amount), unit } };
}

/**
 * Adds a typed allergen to the list, as the server stores it (trimmed, lower case). Blanks and
 * repeats leave the list as it was.
 */
export function addAllergen(allergens: string[], typed: string): string[] {
  const allergen = typed.trim().toLowerCase();
  return allergen === '' || allergens.includes(allergen) ? allergens : [...allergens, allergen];
}

/** The allergens, counting one still typed in the box rather than silently dropping it. */
export function allergensChanges(allergens: string[], typed: string): ResultChanges {
  return { allergens: addAllergen(allergens, typed) };
}

/** One ingredient row as edited: the ingredient, with its percentage as typed. */
export interface IngredientDraft {
  ingredient: Ingredient;
  percent: string;
}

export function ingredientDrafts(ingredients: Ingredient[]): IngredientDraft[] {
  return ingredients.map((ingredient) => ({ ingredient, percent: ingredient.percent === null ? '' : String(ingredient.percent) }));
}

/** The rows, in order. A row left without a name is dropped rather than refused. */
export function ingredientsChanges(rows: IngredientDraft[]): ResultChanges {
  return {
    ingredients: rows
      .filter((row) => row.ingredient.name.trim() !== '')
      .map((row) => ({
        ...row.ingredient,
        name: row.ingredient.name.trim(),
        percent: row.percent.trim() === '' ? null : Number(row.percent),
      })),
  };
}
