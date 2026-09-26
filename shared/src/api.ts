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
  /**
   * An identical file (same SHA-256) is already in Products, or among the asker's own uploads being
   * read or waiting for review: nothing to upload.
   */
  | { kind: 'duplicate'; upload: UploadSummary };

/** GET /api/uploads */
export interface ListUploadsResponse {
  uploads: UploadSummary[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}

/**
 * GET /api/uploads/:id, POST …/complete, POST …/retry, POST …/revert, PATCH …/result
 * (RESULT_EDIT_PATH). (DELETE /api/uploads/:id answers 204 with no body.) Each answers 404 for an
 * upload the asker can't see, whatever they asked.
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

/**
 * POST /api/uploads/delete: the uploads deleted. Any others named weren't deleted: they weren't the
 * asker's to delete, or weren't there (or not for the asker to see). If file storage can't be
 * reached, none is deleted and the request fails (503).
 */
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
  | 'EDIT_CONFLICT' // PATCH …/result or POST …/revert: someone else saved a change first
  | 'NOT_EDITABLE' // PATCH …/result or POST …/revert: the upload isn't completed (or, to edit, its result can't be read)
  | 'UNAUTHENTICATED' // no valid sign-in
  | 'FORBIDDEN' // signed in, but not allowed (no access, not an admin, or not the uploader of one they can see)
  | 'BAD_REQUEST'
  | 'NOT_FOUND' // no such upload, or none the asker may see
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
