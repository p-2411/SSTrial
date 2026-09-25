import { z } from 'zod';
import { CONFIDENCE_FIELDS, type ExtractionConfidence } from './confidence.ts';
import { NET_QUANTITY_UNITS } from './units.ts';

/**
 * The structured data we extract from a product label — our own schema, independent of any LLM.
 *
 * The worker runs every LLM response through `labelExtractionSchema` before storing it, so:
 *   - anything that isn't this shape is rejected (and the job retried) rather than stored;
 *   - cosmetic noise is normalised (whitespace trimmed, "" → null, duplicate allergens removed),
 *     so the UI never has to defend against it.
 *
 * The prompt/JSON-schema we *send* to the model lives in `server/src/extraction` — that's the
 * wire contract with an unreliable dependency; this file is the domain contract we trust.
 */

/** Guards against runaway output (e.g. a model looping) being stored as "data". */
const MAX_TEXT_LENGTH = 300;
const MAX_LIST_ITEMS = 150;

/** Collapses internal whitespace and trims. */
function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** A nullable text field: blank strings become `null`; over-long values fail validation. */
const optionalText = z
  .string()
  .nullable()
  .transform((value) => (value === null ? null : clean(value) || null))
  .pipe(z.string().max(MAX_TEXT_LENGTH).nullable());

/** A list of text items: blanks dropped, case-insensitive duplicates removed, order preserved. */
const textList = z
  .array(z.string())
  .max(MAX_LIST_ITEMS)
  .transform((items) => {
    const seen = new Set<string>();
    return items.map(clean).filter((item) => {
      const key = item.toLowerCase();
      if (item === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })
  .pipe(z.array(z.string().max(MAX_TEXT_LENGTH)));

const netQuantitySchema = z.object({
  /** Numeric amount, e.g. 500. */
  value: z.number().positive().finite(),
  unit: z.enum(NET_QUANTITY_UNITS),
  /** Exactly as printed, e.g. "Net Wt 16 oz (454 g)" — keeps dual units and wording. */
  text: z.string().transform(clean).pipe(z.string().min(1).max(MAX_TEXT_LENGTH)),
});

/** A list of names compared case-insensitively (allergens): cleaned, deduplicated, lowercased. */
const lowercaseList = textList.transform((items) => items.map((item) => item.toLowerCase()));

/** One ingredient, split into the parts people check on a label. */
const ingredientSchema = z.object({
  /** Name without emphasis capitals, percentage or bracketed parts, e.g. "Rolled oats". */
  name: z.string().transform(clean).pipe(z.string().min(1).max(MAX_TEXT_LENGTH)),
  /** Percentage printed for this ingredient, e.g. 48 for "(48%)"; `null` when none is printed. */
  percent: z.number().min(0).max(100).nullable(),
  /** Components listed in brackets after a compound ingredient, e.g. ["rice", "salt"]. */
  subIngredients: textList,
  /** Which of the declared allergens this ingredient contains, e.g. ["wheat", "gluten"]. */
  allergens: lowercaseList,
});

/**
 * Results stored before ingredients were structured hold plain strings ("Rolled OATS (48%)").
 * They're still accepted, as an ingredient with just a name, so old uploads keep displaying.
 */
const legacyIngredient = z
  .string()
  .transform(clean)
  .pipe(z.string().max(MAX_TEXT_LENGTH))
  .transform((name): z.output<typeof ingredientSchema> => ({ name, percent: null, subIngredients: [], allergens: [] }));

export const labelExtractionSchema = z
  .object({
    productName: optionalText,
    brand: optionalText,
    /** In label order, which by law is heaviest first. */
    ingredients: z
      .array(z.union([ingredientSchema, legacyIngredient]))
      .max(MAX_LIST_ITEMS)
      // Drop blanks and repeats (labels don't list an ingredient twice).
      .transform((items) => {
        const seen = new Set<string>();
        return items.filter((item) => {
          const key = item.name.toLowerCase();
          if (item.name === '' || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }),
    /** Declared allergens ("Contains: …" statements and emphasised ingredients), normalised to lowercase. */
    allergens: lowercaseList,
    /** Net weight or volume. `null` when the label doesn't state one. */
    netWeight: netQuantitySchema.nullable(),
  })
  // An ingredient can only "contain" an allergen the label actually declares; drop anything else
  // rather than highlight an allergen the rest of the result doesn't mention.
  .transform((extraction) => {
    const declared = new Set(extraction.allergens);
    return {
      ...extraction,
      ingredients: extraction.ingredients.map((ingredient) => ({
        ...ingredient,
        allergens: ingredient.allergens.filter((allergen) => declared.has(allergen)),
      })),
    };
  });

/** What we store and what the UI renders (post-normalisation). */
export type LabelExtraction = z.output<typeof labelExtractionSchema>;
export type Ingredient = z.output<typeof ingredientSchema>;
export type NetQuantity = z.output<typeof netQuantitySchema>;

/** True when the model found nothing at all — e.g. the image isn't a product label. */
export function isEmptyExtraction(extraction: LabelExtraction): boolean {
  return (
    extraction.productName === null &&
    extraction.brand === null &&
    extraction.ingredients.length === 0 &&
    extraction.allergens.length === 0 &&
    extraction.netWeight === null
  );
}

const fieldConfidenceSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),
});

/** Confidence as stored with an upload (see confidence.ts). */
export const extractionConfidenceSchema: z.ZodType<ExtractionConfidence> = z.object(
  Object.fromEntries(CONFIDENCE_FIELDS.map((field) => [field, fieldConfidenceSchema])) as Record<
    (typeof CONFIDENCE_FIELDS)[number],
    typeof fieldConfidenceSchema
  >,
);
