/**
 * Units we accept for net quantity. Labels state either mass or volume.
 *
 * Kept out of extraction.ts, which builds Zod schemas as it loads: the web app uses these, and
 * importing anything from that file would ship all of Zod to the browser.
 */
export const NET_QUANTITY_UNITS = ['mg', 'g', 'kg', 'oz', 'lb', 'ml', 'cl', 'l', 'fl oz'] as const;
export type NetQuantityUnit = (typeof NET_QUANTITY_UNITS)[number];

const MEASURED_QUANTITY = {
  mg: 'mass',
  g: 'mass',
  kg: 'mass',
  oz: 'mass',
  lb: 'mass',
  ml: 'volume',
  cl: 'volume',
  l: 'volume',
  'fl oz': 'volume',
} as const satisfies Record<NetQuantityUnit, 'mass' | 'volume'>;

/** Whether a unit measures volume (a label's "net volume") rather than mass ("net weight"). */
export function isVolumeUnit(unit: NetQuantityUnit): boolean {
  return MEASURED_QUANTITY[unit] === 'volume';
}

/** Whether a printed net quantity ("Net Wt 16 oz (454 g)") states this amount. */
export function textShowsAmount(text: string, amount: number): boolean {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).flatMap(readings).some((n) => Math.abs(n - amount) < 1e-9);
}

/**
 * Every amount a written number could mean. Labels use both "." and "," as the decimal mark, and
 * either as a thousands separator, so "1,000" reads as 1000 or 1, "454,0" as 454, "2.2" as 2.2.
 */
function readings(written: string): number[] {
  const [first, ...rest] = written.split(/[.,]/);
  if (rest.length === 0) return [Number(first)];
  // The last mark as the decimal point, any earlier ones as thousands separators…
  const asDecimal = Number(`${[first, ...rest.slice(0, -1)].join('')}.${rest.at(-1)}`);
  // …or, when every group after the first has three digits, all of them as thousands separators.
  return rest.every((group) => group.length === 3) ? [asDecimal, Number([first, ...rest].join(''))] : [asDecimal];
}
