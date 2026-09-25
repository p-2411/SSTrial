import type { ExtractionConfidence } from './confidence.ts';
import type { FieldReviews } from './edits.ts';
import type { LabelExtraction } from './extraction.ts';
import type { SupportedMimeType } from './files.ts';

/**
 * Lifecycle of an upload:
 *
 *   uploading ──(browser confirms upload)──► queued ──(worker picks up)──► processing ──► completed
 *                                              ▲                               │
 *                                              └──────(transient error, retry)─┤
 *                                                                              └──► failed
 *
 * `uploading` rows exist between "API issued a signed URL" and "browser confirmed the upload".
 * They're hidden from the list; the browser shows its own in-flight uploads instead.
 */
export const UPLOAD_STATUSES = ['uploading', 'queued', 'processing', 'completed', 'failed'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export function isUploadStatus(value: string): value is UploadStatus {
  return (UPLOAD_STATUSES as readonly string[]).includes(value);
}

/**
 * The views of the upload list. The server does the filtering and counting, so both stay correct
 * however many uploads there are. `uploading` is in none of them: the browser shows its own.
 */
export const UPLOAD_FILTERS = {
  all: ['queued', 'processing', 'completed', 'failed'],
  'in-progress': ['queued', 'processing'],
  completed: ['completed'],
  failed: ['failed'],
} as const satisfies Record<string, readonly Exclude<UploadStatus, 'uploading'>[]>;

export type UploadFilter = keyof typeof UPLOAD_FILTERS;
export const UPLOAD_FILTER_IDS = Object.keys(UPLOAD_FILTERS) as UploadFilter[];

/** Whether the upload is still being worked on (and so worth watching for changes). */
export function isActiveStatus(status: UploadStatus): boolean {
  return (UPLOAD_FILTERS['in-progress'] as readonly UploadStatus[]).includes(status);
}

/**
 * Why an upload failed (or, while `queued`, why its last attempt failed). Only the code is stored;
 * the message users see comes from UPLOAD_ERROR_MESSAGES, so rewording a message is a code change
 * that applies to every upload at once — never a data migration.
 */
export const UPLOAD_ERROR_MESSAGES = {
  // LLM problems (see server/src/extraction/errors.ts for which are retried)
  LLM_TIMEOUT: 'The AI service took too long to respond.',
  LLM_RATE_LIMITED: 'The AI service is rate-limiting requests.',
  LLM_UNAVAILABLE: 'The AI service is temporarily unavailable.',
  LLM_INVALID_RESPONSE: "The AI service returned data that didn't match the expected format.",
  LLM_REFUSED: 'The AI service declined to process this file.',
  LLM_REJECTED_INPUT: "The AI service couldn't read this file.",
  LLM_QUOTA_EXCEEDED: 'The AI service account has run out of credit.',
  LLM_MISCONFIGURED: 'The AI service rejected our request because of a configuration problem.',
  // Everything else
  NO_LABEL_DATA: "Couldn't find any product label information in this file.", // answered, but nothing label-like
  FILE_MISSING: 'The uploaded file could not be found.', // object gone from storage before the worker read it
  PROCESSING_TIMEOUT: 'Processing stopped before it could finish.', // worker died or hung on every attempt
  INTERNAL_ERROR: 'Something went wrong while processing this file.',
} as const;

export type UploadErrorCode = keyof typeof UPLOAD_ERROR_MESSAGES;

/**
 * A code read back from storage. One this version no longer knows (renamed or removed since it was
 * stored) reads as a generic failure, so there's always a message to show.
 */
export function storedErrorCode(value: string): UploadErrorCode {
  return Object.hasOwn(UPLOAD_ERROR_MESSAGES, value) ? (value as UploadErrorCode) : 'INTERNAL_ERROR';
}

export function uploadErrorMessage(code: UploadErrorCode): string {
  return UPLOAD_ERROR_MESSAGES[code];
}

/** Failures caused by the file itself: running it through the pipeline again can't help. */
const FILE_PROBLEMS: readonly UploadErrorCode[] = ['FILE_MISSING'];

/**
 * Whether the user may run extraction again. Used by the UI (to show the button) and the API (to
 * enforce it). Allowed for failures the file itself didn't cause — including permanent LLM
 * failures like a refusal, since the cause may have been fixed (credit topped up, key rotated…) —
 * and for completed uploads whose saved result can no longer be read.
 */
export function canRetryUpload(upload: {
  status: UploadStatus;
  error: { code: UploadErrorCode } | null;
  resultUnreadable: boolean;
}): boolean {
  if (upload.status === 'completed') return upload.resultUnreadable;
  return upload.status === 'failed' && upload.error !== null && !FILE_PROBLEMS.includes(upload.error.code);
}

/** One upload as shown in the list. Dates are ISO-8601 strings (JSON has no Date type). */
export interface UploadSummary {
  id: string;
  fileName: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
  status: UploadStatus;
  /** How many processing attempts have started (0 until the worker first picks it up). */
  attempts: number;
  /** Total attempts the worker will make before giving up. */
  maxAttempts: number;
  /**
   * When `failed`: why it failed permanently.
   * When `queued` with attempts > 0: why the last attempt failed — it will be retried.
   * Otherwise `null`.
   */
  error: { code: UploadErrorCode; message: string } | null;
  /** Extracted product name, so the list can show what each file turned out to be. */
  productName: string | null;
  /**
   * True when the upload completed but its saved result can't be read any more (e.g. saved in a
   * shape this version doesn't understand). It can be run again to replace it.
   */
  resultUnreadable: boolean;
  /**
   * How sure the extraction is, out of 100: its least certain field (see confidence.ts). Null when
   * it wasn't scored, or the upload isn't completed.
   */
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** One upload with everything the detail view needs. */
export interface UploadDetail extends UploadSummary {
  /** Extracted data; present only when `completed`. */
  result: LabelExtraction | null;
  /** Short-lived signed URL for previewing the original file, or `null` if unavailable. */
  fileUrl: string | null;
  /** How sure the extraction is of each field, when it was scored. */
  fieldConfidence: ExtractionConfidence | null;
  /** Who has edited or checked which fields (see edits.ts). */
  fieldReviews: FieldReviews;
  /** Goes up with every saved edit; an edit must name the revision it was made against. */
  revision: number;
  /** Email of whoever uploaded it; null for uploads from before sign-in existed. */
  uploadedBy: string | null;
}
