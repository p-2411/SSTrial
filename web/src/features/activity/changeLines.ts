import type { LabelField, NetQuantityUnit } from '@label-extractor/shared';
import { formatQuantity } from '@/lib/quantity';

/**
 * What a change did to one field, as lines of a diff: each value written out a line per item
 * (an ingredient, an allergen), then the lines compared, so a long list shows just what changed.
 * Values are as they were stored at the time, so any older shape is written out as best it can be.
 */

export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string } | { kind: 'unchanged'; count: number };

/** A field's value as lines: none for no value. */
export function fieldLines(field: LabelField, value: unknown): string[] {
  if (value === null || value === undefined) return [];
  switch (field) {
    case 'productName':
    case 'brand':
      return [String(value)];
    case 'netWeight':
      return [netWeightLine(value)];
    case 'allergens':
      return Array.isArray(value) ? value.map(String) : [String(value)];
    case 'ingredients':
      return Array.isArray(value) ? value.map(ingredientLine) : [String(value)];
  }
}

/** "454 g", and the pack's wording when it says more: "454 g (Net Wt 16 oz (454 g))". */
function netWeightLine(value: unknown): string {
  if (!isRecord(value) || typeof value.value !== 'number' || typeof value.unit !== 'string') return JSON.stringify(value);
  const amount = formatQuantity({ value: value.value, unit: value.unit as NetQuantityUnit });
  return typeof value.text === 'string' && value.text !== amount ? `${amount} (${value.text})` : amount;
}

/** "Rolled oats 48% (oats, salt)". Ingredients stored as plain text stay as they were. */
function ingredientLine(ingredient: unknown): string {
  if (!isRecord(ingredient) || typeof ingredient.name !== 'string') return String(ingredient);
  const percent = typeof ingredient.percent === 'number' ? ` ${ingredient.percent}%` : '';
  const parts = Array.isArray(ingredient.subIngredients) && ingredient.subIngredients.length > 0 ? ` (${ingredient.subIngredients.join(', ')})` : '';
  return `${ingredient.name}${percent}${parts}`;
}

/**
 * The lines before and after, compared: what's in both stays, in order, and the rest was removed
 * or added. A longest-common-subsequence diff; a label's lists are short enough (150 at most).
 */
export function diffLines(before: string[], after: string[]): Array<Extract<DiffLine, { text: string }>> {
  const n = before.length;
  const m = after.length;
  // common[i][j]: how many lines before[i..] and after[j..] have in common, in order.
  const common = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i]![j] = before[i] === after[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const lines: Array<Extract<DiffLine, { text: string }>> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i++]! });
      j++;
    } else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
      lines.push({ kind: 'removed', text: before[i++]! });
    } else {
      lines.push({ kind: 'added', text: after[j++]! });
    }
  }
  while (i < n) lines.push({ kind: 'removed', text: before[i++]! });
  while (j < m) lines.push({ kind: 'added', text: after[j++]! });
  return lines;
}

/**
 * A diff with long runs of unchanged lines folded away, keeping `context` lines either side of
 * each change so it's clear where in the list it happened.
 */
export function foldUnchanged(lines: Array<Extract<DiffLine, { text: string }>>, context = 1): DiffLine[] {
  const nearChange = lines.map((_line, index) =>
    lines.slice(Math.max(0, index - context), index + context + 1).some((line) => line.kind !== 'same'),
  );
  const folded: DiffLine[] = [];
  let run: DiffLine[] = [];
  // A run of one isn't worth folding: the line takes no more room than saying it's there.
  const endRun = () => {
    folded.push(...(run.length > 1 ? [{ kind: 'unchanged' as const, count: run.length }] : run));
    run = [];
  };
  lines.forEach((line, index) => {
    if (line.kind === 'same' && !nearChange[index]) {
      run.push(line);
    } else {
      endRun();
      folded.push(line);
    }
  });
  endRun();
  return folded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
