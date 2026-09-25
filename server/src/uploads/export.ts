import type { Ingredient } from '@label-extractor/shared';
import type { UploadRecord } from './store.ts';

/**
 * Turns completed uploads into downloadable CSV or JSON.
 *
 * Both formats are produced as async generators of text chunks, so the route can stream an export
 * of any size without holding every row in memory.
 */

/** CSV columns: one row per product, the shape you'd paste into a spreadsheet or PIM. */
const CSV_COLUMNS = [
  'Upload ID',
  'File name',
  'Uploaded at',
  'Product name',
  'Brand',
  'Net quantity',
  'Unit',
  'Net quantity as printed',
  'Allergens',
  'Ingredients',
] as const;

export async function* toCsv(records: AsyncIterable<UploadRecord>): AsyncGenerator<string> {
  // The byte-order mark makes Excel read the file as UTF-8 (otherwise "é" and "µ" come out garbled).
  yield `﻿${csvRow(CSV_COLUMNS)}`;
  for await (const record of records) {
    const result = record.result;
    if (!result) continue;
    yield csvRow([
      record.id,
      record.fileName,
      record.createdAt.toISOString(),
      result.productName,
      result.brand,
      result.netWeight?.value ?? null,
      result.netWeight?.unit ?? null,
      result.netWeight?.text ?? null,
      result.allergens.join('; '),
      result.ingredients.map(formatIngredient).join('; '),
    ]);
  }
}

export async function* toJson(records: AsyncIterable<UploadRecord>, exportedAt: Date): AsyncGenerator<string> {
  yield `{"exportedAt":${JSON.stringify(exportedAt.toISOString())},"uploads":[`;
  let first = true;
  for await (const record of records) {
    if (!record.result) continue;
    const entry = {
      id: record.id,
      fileName: record.fileName,
      uploadedAt: record.createdAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
      ...record.result,
    };
    yield `${first ? '' : ','}\n${JSON.stringify(entry)}`;
    first = false;
  }
  yield '\n]}\n';
}

/** "Rolled oats (48%)", "Puffed rice [rice, salt]" — percentage in round brackets, parts in square. */
export function formatIngredient(ingredient: Ingredient): string {
  let text = ingredient.name;
  if (ingredient.percent !== null) text += ` (${ingredient.percent}%)`;
  if (ingredient.subIngredients.length > 0) text += ` [${ingredient.subIngredients.join(', ')}]`;
  return text;
}

function csvRow(values: ReadonlyArray<string | number | null>): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/**
 * One CSV field (RFC 4180): quoted when it contains a comma, quote or line break, with quotes
 * doubled. Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR at the start) is
 * prefixed with an apostrophe — the text comes from uploaded labels, so it can't be trusted.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
