import { needsChecking, type ExtractionConfidence } from './confidence.ts';
import type { FieldReviews } from './edits.ts';
import type { LabelExtraction } from './extraction.ts';
import type { SupportedMimeType } from './files.ts';

/**
 * Where an upload is in its life. How it moves between these is in lifecycle.ts.
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
 * The three upload lists, filtered by the server, one for each stage a file goes through:
 *   upload    the signed-in person's own uploads still being read, or failed
 *   review    their own uploads that have been read, waiting to be checked and submitted
 *   products  submitted products, everyone's: the shared, lasting record
 * The first two are nobody else's business (see canViewUpload). `uploading` is in none: until its
 * bytes have arrived, the browser that's sending it shows it.
 */
export const UPLOAD_VIEWS = {
  upload: { statuses: ['queued', 'processing', 'failed'], submitted: null, own: true },
  review: { statuses: ['completed'], submitted: false, own: true },
  products: { statuses: ['completed'], submitted: true, own: false },
} as const satisfies Record<
  string,
  { statuses: readonly Exclude<UploadStatus, 'uploading'>[]; submitted: boolean | null; own: boolean }
>;

export type UploadView = keyof typeof UPLOAD_VIEWS;
export const UPLOAD_VIEW_IDS = Object.keys(UPLOAD_VIEWS) as UploadView[];

/** An upload as the API sends it (dates as strings) or the server keeps it (as Dates): enough to say which stage it's at. */
interface Staged {
  status: UploadStatus;
  submittedAt: string | Date | null;
}

/** Whether an upload is in Products: read, and submitted by its uploader (the `products` view). */
export function isProduct(upload: Staged): boolean {
  return upload.status === 'completed' && upload.submittedAt !== null;
}

/** Whether an upload is waiting in its uploader's Review list: read, readable, and not submitted yet. */
export function isInReview(upload: Staged & { resultUnreadable: boolean }): boolean {
  return upload.status === 'completed' && upload.submittedAt === null && !upload.resultUnreadable;
}

/**
 * Whether an upload can go into Products: it's in Review (see isInReview) and nothing in it is left
 * to check. Every field is confident, or a person has checked (or corrected) the ones that weren't,
 * so its overall score (its least certain field, a reviewed one counting as 100) is confident.
 */
export function canSubmitUpload(upload: Pick<UploadSummary, 'status' | 'submittedAt' | 'resultUnreadable' | 'confidence'>): boolean {
  return isInReview(upload) && !stillToCheck(upload);
}

/** Whether a read upload has fields that must be checked before it can be submitted. */
export function stillToCheck(upload: Pick<UploadSummary, 'status' | 'confidence'>): boolean {
  return upload.status === 'completed' && upload.confidence !== null && needsChecking(upload.confidence);
}

/** Statuses still being worked on: worth watching for changes, and not ready to open. */
const ACTIVE_STATUSES: readonly UploadStatus[] = ['queued', 'processing'];

/** Whether the upload is still being worked on (and so worth watching for changes). */
export function isActiveStatus(status: UploadStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Most files one person can pick at once. Each is fingerprinted in the browser before it's sent, a
 * few at a time, so this keeps a batch quick to start and the page responsive.
 */
export const MAX_FILES_PER_BATCH = 50;

/**
 * Most uploads one person can have under way (uploading, waiting or being read) at once. Checked
 * when an upload is requested, so nobody can fill the queue for everyone else.
 */
export const MAX_OPEN_UPLOADS_PER_PERSON = 200;

/**
 * Most uploads one request can name, to submit, mark as checked, delete or export at once: a page or
 * two of a list, which keeps a request short.
 */
export const MAX_UPLOADS_PER_REQUEST = 100;

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

/** Failures where the file is gone: running it through the pipeline again can't help. */
const FILE_PROBLEMS: readonly UploadErrorCode[] = ['FILE_MISSING'];

/**
 * Whether an upload may be read again, as far as its state goes (who may ask: see canDeleteUpload).
 * Used by the UI (to show the button) and the API (to enforce it). Allowed for every failure but a
 * missing file — permanent ones too, like a refusal or no label found, since the cause may have
 * been fixed (credit topped up, key rotated…) or a second reading may differ — and for completed
 * uploads whose saved result can no longer be read.
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
   * How sure the extraction is, out of 100: its least certain field, a field a person has checked
   * or corrected counting as 100 (see confidence.ts). Null when it wasn't scored, or the upload isn't
   * completed.
   */
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** When it went into Products; null while it's still being uploaded, read or reviewed. */
  submittedAt: string | null;
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
  /** Whether the person asking may delete it (see canDeleteUpload). */
  canDelete: boolean;
  /** Whether the person asking may put its data back to a point in its history: admins, once it's completed. */
  canRevert: boolean;
}
