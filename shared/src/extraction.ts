import { z } from 'zod';

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

/** Units we accept for net quantity. Labels state either mass or volume. */
export const NET_QUANTITY_UNITS = ['mg', 'g', 'kg', 'oz', 'lb', 'ml', 'cl', 'l', 'fl oz'] as const;
export type NetQuantityUnit = (typeof NET_QUANTITY_UNITS)[number];

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

export const netQuantitySchema = z.object({
  /** Numeric amount, e.g. 500. */
  value: z.number().positive().finite(),
  unit: z.enum(NET_QUANTITY_UNITS),
  /** Exactly as printed, e.g. "Net Wt 16 oz (454 g)" — keeps dual units and wording. */
  text: z.string().transform(clean).pipe(z.string().min(1).max(MAX_TEXT_LENGTH)),
});

export const labelExtractionSchema = z.object({
  productName: optionalText,
  brand: optionalText,
  /** In label order. Sub-ingredients stay inside their parent, e.g. "Chocolate (sugar, cocoa butter)". */
  ingredients: textList,
  /** Declared allergens ("Contains: …" statements and emphasised ingredients), normalised to lowercase. */
  allergens: textList.transform((items) => items.map((item) => item.toLowerCase())),
  /** Net weight or volume. `null` when the label doesn't state one. */
  netWeight: netQuantitySchema.nullable(),
});

/** What we store and what the UI renders (post-normalisation). */
export type LabelExtraction = z.output<typeof labelExtractionSchema>;
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
