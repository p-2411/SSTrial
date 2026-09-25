import type { NetQuantity, NetQuantityUnit } from '@label-extractor/shared';

/** Litres as "L": a lowercase l is easily misread as the digit 1 ("1 l"). */
const UNIT_DISPLAY: Partial<Record<NetQuantityUnit, string>> = { l: 'L' };

/** { 500, g } → "500 g"; { 1.5, l } → "1.5 L"; long decimals are rounded to 2 places. */
export function formatQuantity({ value, unit }: NetQuantity): string {
  const amount = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${amount} ${UNIT_DISPLAY[unit] ?? unit}`;
}
