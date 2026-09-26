import type { UploadStatus } from './uploads.ts';

/**
 * Every way an upload can change: which statuses each change may start from, and where it leads.
 * The server's store guards every write to an upload with these (`… where status = any(from)`), so
 * a change that isn't allowed from an upload's current status simply doesn't happen, however many
 * processes try at once.
 *
 *   uploading ──confirm──► queued ──claim──► processing ──complete──► completed ─┐
 *       │                     ▲                 │    │                  ▲       │ review, revert,
 *    discard                  └───retryLater────┘   fail ──► failed     └───────┘ submit
 *       ▼
 *   (deleted)       plus: abandon (queued|processing → failed), rerun (failed|completed → queued),
 *                   delete (any listed status → deleted)
 */
export const UPLOAD_TRANSITIONS = {
  /** The file arrived and is a supported type: queue it for extraction. */
  confirm: { from: ['uploading'], to: 'queued' },
  /** The file was rejected, or never arrived: the upload is deleted. */
  discard: { from: ['uploading'], to: null },
  /** A worker starts an attempt. From `processing` too, so a job retried after a crash can take over. */
  claim: { from: ['queued', 'processing'], to: 'processing' },
  /** The attempt produced valid data. */
  complete: { from: ['processing'], to: 'completed' },
  /** The attempt failed in a way worth retrying; the queue will try again after a delay. */
  retryLater: { from: ['processing'], to: 'queued' },
  /** The attempt failed for good, or was the last one. */
  fail: { from: ['processing'], to: 'failed' },
  /** Every attempt died without finishing (the dead-letter safety net). */
  abandon: { from: ['queued', 'processing'], to: 'failed' },
  /** A person corrects or confirms the extracted data. It stays completed, one revision on. */
  review: { from: ['completed'], to: 'completed' },
  /** An admin puts the data back to a saved version (see canRevertUpload). It stays completed, one revision on. */
  revert: { from: ['completed'], to: 'completed' },
  /** Its uploader puts it into Products, once nothing in it is left to check (see canSubmitUpload). */
  submit: { from: ['completed'], to: 'completed' },
  /** Someone asked to run extraction again (see canRetryUpload for when that's offered). */
  rerun: { from: ['failed', 'completed'], to: 'queued' },
  /**
   * Someone deleted it (see canDeleteUpload for who may). From any status the list shows, even
   * mid-extraction: that attempt's writes are refused once the row is gone. An upload still being
   * uploaded isn't listed anywhere, and settles itself (the finalise job).
   */
  delete: { from: ['queued', 'processing', 'completed', 'failed'], to: null },
} as const satisfies Record<string, { from: readonly UploadStatus[]; to: UploadStatus | null }>;

export type UploadTransition = keyof typeof UPLOAD_TRANSITIONS;

/** Whether `transition` may start from an upload in `status`. */
export function canTransition(transition: UploadTransition, status: UploadStatus): boolean {
  return (UPLOAD_TRANSITIONS[transition].from as readonly UploadStatus[]).includes(status);
}

/** The transitions after which the upload still exists (every one but discard and delete). */
export type UploadTransitionKeepingRow = {
  [T in UploadTransition]: (typeof UPLOAD_TRANSITIONS)[T]['to'] extends null ? never : T;
}[UploadTransition];
