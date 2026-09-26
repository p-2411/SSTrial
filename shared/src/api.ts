import type { FileValidationErrorCode } from './files.ts';
import type { UploadDetail, UploadStatus, UploadSummary } from './uploads.ts';

/**
 * The HTTP API's contract: response bodies, error codes and the live event stream. Request bodies
 * and query strings are Zod schemas in requests.ts, which the web app never loads at runtime.
 */

/** POST /api/uploads */
export type CreateUploadResponse =
  | {
      kind: 'created';
      upload: UploadSummary;
      /** Upload the file with `PUT uploadUrl` (body = raw file bytes, `Content-Type` = file type). */
      uploadUrl: string;
    }
  /** An identical file is already queued, processing or done: nothing to upload. */
  | { kind: 'duplicate'; upload: UploadSummary };

/** GET /api/uploads */
export interface ListUploadsResponse {
  uploads: UploadSummary[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}

/**
 * GET /api/uploads/:id, POST …/complete, POST …/retry, PATCH …/result (RESULT_EDIT_PATH).
 * (DELETE /api/uploads/:id answers 204 with no body.)
 */
export interface UploadResponse {
  upload: UploadDetail;
}

/**
 * POST /api/uploads/submit: the uploads now in Products. Any others named weren't submitted: they
 * still had fields to check, were already in, or weren't the asker's to submit.
 */
export interface SubmitUploadsResponse {
  submitted: string[];
}

/** POST /api/uploads/delete: the uploads deleted. Any others named weren't the asker's to delete, or were gone. */
export interface DeleteUploadsResponse {
  deleted: string[];
}

/** POST /api/uploads/check: the uploads whose flagged fields are now marked as checked. */
export interface CheckUploadsResponse {
  checked: string[];
}

export type ApiErrorCode =
  | FileValidationErrorCode // POST /api/uploads: the file's name, type or size
  | 'TOO_MANY_UPLOADS' // POST /api/uploads: this person already has MAX_OPEN_UPLOADS_PER_PERSON under way
  | 'FILE_NOT_UPLOADED' // POST …/complete: nothing arrived in storage
  | 'FILE_CONTENT_MISMATCH' // POST …/complete: the bytes aren't a supported type
  | 'NOT_RETRYABLE' // POST …/retry
  | 'INVALID_EDIT' // PATCH …/result: a value the extraction schema rejects
  | 'EDIT_CONFLICT' // PATCH …/result: someone else saved a change first
  | 'NOT_EDITABLE' // PATCH …/result: the upload isn't completed, or its result can't be read
  | 'UNAUTHENTICATED' // no valid sign-in
  | 'FORBIDDEN' // signed in, but not allowed (no access, or not an admin)
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'STORAGE_UNAVAILABLE'
  | 'AUTH_UNAVAILABLE' // Supabase Auth couldn't be reached to check the sign-in
  | 'INTERNAL_ERROR';

/** Every non-2xx response has this shape. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/**
 * GET /api/events — server-sent events announcing changes, so the UI refreshes exactly when
 * something changes. Each event is named after its `type`, with the change as JSON data.
 */
export const LIVE_EVENTS_PATH = '/api/events';

export type LiveChange =
  | { type: 'upload'; id: string; status: UploadStatus }
  /** New events were written to the activity log (GET /api/logs). */
  | { type: 'log' }
  /** The server may have missed changes (its database feed reconnected): refetch everything. */
  | { type: 'resync' };
