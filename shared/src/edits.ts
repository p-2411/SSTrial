import type { ConfidenceField } from './confidence.ts';
import type { Ingredient } from './extraction.ts';
import type { NetQuantityUnit } from './units.ts';

/**
 * Editing extracted data in place: what can change, and who reviewed each field. Zod-free (the web
 * app imports it); the request's schema is in requests.ts.
 */

/** A person's corrections. Only the fields given change; each is re-validated like model output. */
export interface ResultChanges {
  productName?: string | null;
  brand?: string | null;
  /**
   * The amount and unit. The pack's printed wording is kept if it states this amount; otherwise
   * (it was misread too, or there was none) it becomes the amount.
   */
  netWeight?: { value: number; unit: NetQuantityUnit } | null;
  allergens?: string[];
  /** The whole list, in label order. Existing rows keep their sub-ingredients and allergen links. */
  ingredients?: Ingredient[];
}

/** PATCH /api/uploads/:id/result */
export interface EditResultRequest {
  /** The revision the edit was made against. A save against an older one is refused (409). */
  revision: number;
  changes?: ResultChanges;
  /** Fields confirmed as right, unchanged. */
  checked?: ConfidenceField[];
}

export const RESULT_EDIT_PATH = (uploadId: string) => `/api/uploads/${encodeURIComponent(uploadId)}/result`;

/** How each field is named to people, in the UI and the activity log. */
export const FIELD_LABELS: Record<ConfidenceField, string> = {
  productName: 'Product name',
  brand: 'Brand',
  netWeight: 'Net weight',
  allergens: 'Allergens',
  ingredients: 'Ingredients',
};

/** A person either corrected a field, or confirmed it was already right. */
export type FieldReviewKind = 'edited' | 'checked';

export interface FieldReview {
  kind: FieldReviewKind;
  /** Their email; null if their account has since been deleted. */
  by: string | null;
  at: string;
}

/** The fields someone has reviewed. A reviewed field no longer counts towards the upload's confidence. */
export type FieldReviews = Partial<Record<ConfidenceField, FieldReview>>;
