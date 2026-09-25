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
