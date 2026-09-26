import type { LabelExtraction } from './extraction.ts';

/**
 * The fields of extracted label data, and how each is named to people. Keyed by every field of
 * LabelExtraction, so adding a field there fails to compile until it's named here; confidence,
 * edits and reviews are all keyed by this list.
 *
 * Zod-free (a type-only import of extraction.ts), so the web app can import it.
 */
export const FIELD_LABELS = {
  productName: 'Product name',
  brand: 'Brand',
  netWeight: 'Net weight',
  allergens: 'Allergens',
  ingredients: 'Ingredients',
} as const satisfies Record<keyof LabelExtraction, string>;

export type LabelField = keyof typeof FIELD_LABELS;

/** In the order the label data is shown. */
export const LABEL_FIELDS = Object.keys(FIELD_LABELS) as LabelField[];

/**
 * What every product must have. One read without it is flagged for a person to look at (see
 * applyConfidenceChecks): they fill it in, or confirm the label really doesn't show it. Allergens
 * aren't here: plenty of products declare none.
 */
export const REQUIRED_FIELDS = ['productName', 'brand', 'netWeight', 'ingredients'] as const satisfies readonly LabelField[];
