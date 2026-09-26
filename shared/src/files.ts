import { formatList } from './text.ts';

/**
 * Which files we accept, and the metadata checks that run *before* anything is uploaded. Zod-free,
 * so the web app can import it.
 *
 * These rules run in three places:
 *   1. the browser, so the user gets instant feedback without a network round-trip;
 *   2. the API, because the browser can't be trusted;
 *   3. Supabase Storage (bucket `allowed_mime_types` / `file_size_limit`, which the API sets from
 *      these constants on start-up), so a signed upload URL can't be used to push a different or
 *      larger file.
 *
 * Metadata can lie (a `.exe` renamed to `.jpg`), so once the file has arrived its leading bytes
 * are checked too — see `server/src/infra/file-signature.ts`.
 */

/** 10 MB — comfortably fits a phone photo or a multi-page label PDF, and keeps LLM payloads sane. */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Longest file name we store. Most filesystems cap names at 255 bytes. */
const MAX_FILE_NAME_LENGTH = 255;

/** Supported MIME types → human label, whether it's a photo or a document, and its extensions. */
export const SUPPORTED_FILE_TYPES = {
  'image/jpeg': { label: 'JPEG', kind: 'image', extensions: ['.jpg', '.jpeg'] },
  'image/png': { label: 'PNG', kind: 'image', extensions: ['.png'] },
  'image/webp': { label: 'WebP', kind: 'image', extensions: ['.webp'] },
  'application/pdf': { label: 'PDF', kind: 'document', extensions: ['.pdf'] },
} as const;

export type SupportedMimeType = keyof typeof SUPPORTED_FILE_TYPES;

export const SUPPORTED_MIME_TYPES = Object.keys(SUPPORTED_FILE_TYPES) as SupportedMimeType[];

/** Value for an `<input type="file" accept="...">` attribute. */
export const FILE_INPUT_ACCEPT = SUPPORTED_MIME_TYPES.flatMap((mime) => [
  mime,
  ...SUPPORTED_FILE_TYPES[mime].extensions,
]).join(',');

/** e.g. "JPEG, PNG, WebP or PDF" — used in UI copy and error messages. */
export const SUPPORTED_TYPES_LABEL = formatList(SUPPORTED_MIME_TYPES.map((m) => SUPPORTED_FILE_TYPES[m].label));

function isSupportedMimeType(value: string): value is SupportedMimeType {
  return Object.hasOwn(SUPPORTED_FILE_TYPES, value);
}

export interface FileMetadata {
  name: string;
  /** MIME type as reported by the browser. Can be empty when the OS doesn't recognise the extension. */
  type: string;
  size: number;
}

export type FileValidationErrorCode =
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'INVALID_FILE_NAME';

export type FileValidationResult =
  | { ok: true; mimeType: SupportedMimeType }
  | { ok: false; code: FileValidationErrorCode; message: string };

/**
 * Validates a file's name, type and size. Pure function, so it's shared by browser and API.
 * Returns the normalised MIME type on success, or a code + human-readable message on failure.
 */
export function validateFileMetadata(file: FileMetadata): FileValidationResult {
  const name = file.name.trim();
  if (name.length === 0 || name.length > MAX_FILE_NAME_LENGTH) {
    return fail('INVALID_FILE_NAME', `File names must be between 1 and ${MAX_FILE_NAME_LENGTH} characters.`);
  }

  // Browsers derive `type` from the extension and leave it empty for unknown ones, so fall back to
  // the extension ourselves. Content is verified properly after upload (magic-byte sniffing).
  const mimeType = normaliseMimeType(file.type) || mimeTypeFromFileName(name);

  if (!mimeType || !isSupportedMimeType(mimeType)) {
    return fail('UNSUPPORTED_FILE_TYPE', unsupportedTypeMessage(name, mimeType));
  }
  if (!Number.isInteger(file.size) || file.size <= 0) {
    return fail('EMPTY_FILE', 'This file is empty.');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(
      'FILE_TOO_LARGE',
      `This file is ${formatBytes(file.size)}. The maximum is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
    );
  }
  return { ok: true, mimeType };
}

/** Best-effort MIME type from a file name's extension, or `null` if we don't recognise it. */
function mimeTypeFromFileName(name: string): SupportedMimeType | null {
  const extension = extensionOf(name);
  if (!extension) return null;
  return SUPPORTED_MIME_TYPES.find((mime) =>
    (SUPPORTED_FILE_TYPES[mime].extensions as readonly string[]).includes(extension),
  ) ?? null;
}

/** Human-readable size, e.g. 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Drop a trailing ".0" so we say "10 MB" rather than "10.0 MB".
  return `${value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

// ---------------------------------------------------------------------------------------------

function fail(code: FileValidationErrorCode, message: string): FileValidationResult {
  return { ok: false, code, message };
}

function normaliseMimeType(type: string): string {
  // "image/jpeg; charset=binary" → "image/jpeg". Some systems also report the legacy "image/jpg".
  const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : null;
}

function unsupportedTypeMessage(name: string, mimeType: string | null): string {
  const extension = extensionOf(name);
  // iPhone photos are the most likely "wrong" upload, so give a specific, actionable hint.
  if (extension === '.heic' || extension === '.heif' || mimeType === 'image/heic' || mimeType === 'image/heif') {
    return `HEIC photos aren't supported. Export the photo as JPEG and upload it again.`;
  }
  const problem = extension ? `"${extension}" files aren't supported.` : `This file type isn't supported.`;
  return `${problem} Upload a ${SUPPORTED_TYPES_LABEL} file.`;
}
