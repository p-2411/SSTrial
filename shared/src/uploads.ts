import { z } from 'zod';
import type { LabelExtraction } from './extraction.ts';
import type { FileValidationErrorCode, SupportedMimeType } from './files.ts';

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
 * Machine-readable reasons an upload failed (or, while `queued`, why its last attempt failed).
 * The human-readable message is stored alongside; these codes let the UI and logs group failures.
 */
export type UploadErrorCode =
  // Rejected before processing
  | FileValidationErrorCode
  | 'FILE_NOT_UPLOADED' // browser said "done" but the object isn't in storage
  | 'FILE_CONTENT_MISMATCH' // bytes don't match a supported type (e.g. renamed .exe)
  // Processing — LLM problems (see server/src/extraction/errors.ts for retry policy)
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_UNAVAILABLE'
  | 'LLM_INVALID_RESPONSE'
  | 'LLM_REFUSED'
  | 'LLM_REJECTED_INPUT'
  | 'LLM_QUOTA_EXCEEDED'
  | 'LLM_MISCONFIGURED'
  // Processing — everything else
  | 'NO_LABEL_DATA' // model answered correctly, but found nothing label-like
  | 'FILE_MISSING' // object disappeared from storage before the worker read it
  | 'PROCESSING_TIMEOUT' // worker died or hung on every attempt
  | 'INTERNAL_ERROR';

/** Failures caused by the file itself: running it through the pipeline again can't help. */
const FILE_PROBLEMS: readonly UploadErrorCode[] = [
  'UNSUPPORTED_FILE_TYPE',
  'FILE_TOO_LARGE',
  'EMPTY_FILE',
  'INVALID_FILE_NAME',
  'FILE_NOT_UPLOADED',
  'FILE_CONTENT_MISMATCH',
  'FILE_MISSING',
];

/**
 * Whether the user may retry a failed upload. Used by the UI (to show the button) and the API
 * (to enforce it). Everything else — including permanent LLM failures like a refusal — can be
 * retried by hand, since the cause may have been fixed (credit topped up, key rotated…).
 */
export function canRetryUpload(upload: { status: UploadStatus; error: { code: UploadErrorCode } | null }): boolean {
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
// HTTP API contracts. Request bodies are Zod schemas (validated by the API); responses are types.
// ---------------------------------------------------------------------------------------------

/** POST /api/uploads — ask for a signed URL to upload one file to. */
export const createUploadRequestSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

export interface CreateUploadResponse {
  upload: UploadSummary;
  /** Upload the file with `PUT uploadUrl` (body = raw file bytes, `Content-Type` = file type). */
  uploadUrl: string;
}

/** GET /api/uploads */
export interface ListUploadsResponse {
  uploads: UploadSummary[];
}

/** GET /api/uploads/:id, POST /api/uploads/:id/complete, POST /api/uploads/:id/retry */
export interface UploadResponse {
  upload: UploadDetail;
}

/** Every non-2xx response has this shape. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}
