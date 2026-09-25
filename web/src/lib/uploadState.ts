import type { UploadSummary } from '@label-extractor/shared';

type UploadError = NonNullable<UploadSummary['error']>;

/**
 * What an upload's status means for the person looking at it. The status alone doesn't say
 * everything: a queued upload may be waiting for its first attempt or retrying after a failed
 * one, and a completed upload's saved result may no longer be readable. Worked out once here so
 * the list row and the detail panel can't disagree; each words it its own way.
 */
export type UploadState =
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
