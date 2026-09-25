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

/** Statuses the UI keeps polling for. */
export const ACTIVE_STATUSES: readonly UploadStatus[] = ['queued', 'processing'];

export function isActiveStatus(status: UploadStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
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

export function uploadErrorMessage(code: UploadErrorCode): string {
  return UPLOAD_ERROR_MESSAGES[code] ?? UPLOAD_ERROR_MESSAGES.INTERNAL_ERROR;
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
}

// ---------------------------------------------------------------------------------------------
// HTTP API contracts: response types here; request schemas (Zod) in requests.ts, which the web
// app never loads at runtime.
// ---------------------------------------------------------------------------------------------

export type CreateUploadResponse =
  | {
      kind: 'created';
      upload: UploadSummary;
      /** Upload the file with `PUT uploadUrl` (body = raw file bytes, `Content-Type` = file type). */
      uploadUrl: string;
    }
  /** An identical file is already queued, processing or done: nothing to upload. */
  | { kind: 'duplicate'; upload: UploadSummary };

/**
 * The views of the upload list. The server does the filtering and counting, so both stay correct
 * however many uploads there are.
 */
export const UPLOAD_FILTERS = {
  all: ['queued', 'processing', 'completed', 'failed'],
  'in-progress': ['queued', 'processing'],
  completed: ['completed'],
  failed: ['failed'],
} as const satisfies Record<string, readonly UploadStatus[]>;

export type UploadFilter = keyof typeof UPLOAD_FILTERS;
export const UPLOAD_FILTER_IDS = Object.keys(UPLOAD_FILTERS) as UploadFilter[];

export interface ListUploadsResponse {
  uploads: UploadSummary[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}

/** GET /api/uploads/counts — how many uploads each view holds. */
export interface UploadCountsResponse {
  counts: Record<UploadFilter, number>;
}

/** GET /api/uploads/:id, POST /api/uploads/:id/complete, POST /api/uploads/:id/retry */
export interface UploadResponse {
  upload: UploadDetail;
}

/** Every non-2xx response has this shape. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}
