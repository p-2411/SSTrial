import type { SupportedMimeType } from '@label-extractor/shared';

/**
 * Identifies a file's real type from its leading bytes ("magic numbers").
 *
 * File names and browser-reported MIME types are just claims; this reads the content. We only
 * need to recognise the four types we accept, so a few byte comparisons beat pulling in a
 * general-purpose detection library.
 */

/** How many leading bytes `detectFileType` needs. */
export const SIGNATURE_BYTES = 1024;

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP", at offset 8
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function detectFileType(bytes: Uint8Array): SupportedMimeType | null {
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  // The PDF spec lets readers tolerate junk before the header, and real-world scanners emit it,
  // so look for "%PDF-" anywhere in the first KB rather than only at offset 0.
  if (indexOf(bytes.subarray(0, SIGNATURE_BYTES), PDF) !== -1) return 'application/pdf';
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function indexOf(bytes: Uint8Array, signature: number[]): number {
  for (let i = 0; i + signature.length <= bytes.length; i++) {
    if (startsWith(bytes, signature, i)) return i;
  }
  return -1;
}
