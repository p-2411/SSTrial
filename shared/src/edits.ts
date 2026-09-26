import type { LabelField } from './fields.ts';

/**
 * Who reviewed each field of an upload's extracted data. Zod-free (the web app imports it); the
 * edit request and its schema are in requests.ts.
 */

export const RESULT_EDIT_PATH = (uploadId: string) => `/api/uploads/${encodeURIComponent(uploadId)}/result`;

/** A person either corrected a field, or confirmed it was already right. */
const FIELD_REVIEW_KINDS = ['edited', 'checked'] as const;
export type FieldReviewKind = (typeof FIELD_REVIEW_KINDS)[number];

export function isFieldReviewKind(value: unknown): value is FieldReviewKind {
  return (FIELD_REVIEW_KINDS as readonly unknown[]).includes(value);
}

export interface FieldReview {
  kind: FieldReviewKind;
  /** Their email; null if their account has since been deleted. */
  by: string | null;
  at: string;
}

/** The fields someone has reviewed. A reviewed field counts as certain (100) in the upload's confidence. */
export type FieldReviews = Partial<Record<LabelField, FieldReview>>;
