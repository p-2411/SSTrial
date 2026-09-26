import type { UploadSummary } from '@label-extractor/shared';
import type { TextTone } from './tone';

type UploadError = NonNullable<UploadSummary['error']>;

/**
 * What an upload's status means for the person looking at it. The status alone doesn't say
 * everything: a queued upload may be waiting for its first attempt or retrying after a failed
 * one, and a completed upload's saved result may no longer be readable. Worked out once here so
 * the list row and the detail panel can't disagree.
 */
type UploadState =
  | { kind: 'uploading' }
  | { kind: 'waiting' }
  | { kind: 'retrying'; error: UploadError }
  | { kind: 'processing' }
  | { kind: 'completed' }
  | { kind: 'unreadable' }
  | { kind: 'failed'; error: UploadError | null };

export function uploadState(upload: Pick<UploadSummary, 'status' | 'error' | 'resultUnreadable'>): UploadState {
  switch (upload.status) {
    case 'uploading':
      return { kind: 'uploading' };
    case 'queued':
      return upload.error ? { kind: 'retrying', error: upload.error } : { kind: 'waiting' };
    case 'processing':
      return { kind: 'processing' };
    case 'completed':
      return upload.resultUnreadable ? { kind: 'unreadable' } : { kind: 'completed' };
    case 'failed':
      return { kind: 'failed', error: upload.error };
  }
}

/** Why an upload failed: the server's reason, or a plain fallback when it gave none. */
export function failureMessage(error: UploadError | null): string {
  return error?.message ?? 'Processing failed.';
}

/**
 * What's happening to an upload that hasn't been read (yet), in one short line: the list row's
 * second line, and the detail's status while it's still being worked on. Null once it's read.
 */
export function progressLine(state: UploadState): { text: string; tone: TextTone } | null {
  switch (state.kind) {
    case 'uploading':
      return { text: 'Uploading', tone: 'muted' };
    case 'waiting':
      return { text: 'Waiting to be processed', tone: 'muted' };
    case 'retrying':
      // Queued again after a failed attempt: say why, and that it's handled.
      return { text: `${state.error.message} Retrying automatically.`, tone: 'warning' };
    case 'processing':
      return { text: 'Reading label', tone: 'brand' };
    case 'failed':
      return { text: failureMessage(state.error), tone: 'danger' };
    case 'completed':
    case 'unreadable':
      return null;
  }
}
