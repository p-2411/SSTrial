import { canRetryUpload } from '@label-extractor/shared';
import type { UploadIntake, UploadQueries, UploadRecord } from './store.ts';

export type RetryResult =
  | { outcome: 'requeued'; upload: UploadRecord }
  /** Nothing to gain from running it again (see canRetryUpload). */
  | { outcome: 'not-retryable'; upload: UploadRecord }
  | { outcome: 'not-found' };

export interface RetryDeps {
  uploads: Pick<UploadQueries, 'findById'> & Pick<UploadIntake, 'requeue'>;
}

/** Runs extraction again for a failed upload, or a completed one whose result can no longer be read. */
export async function retryUpload(deps: RetryDeps, id: string): Promise<RetryResult> {
  const upload = await deps.uploads.findById(id);
  if (!upload) return { outcome: 'not-found' };
  if (!canRetryUpload(upload)) return { outcome: 'not-retryable', upload };

  const requeued = await deps.uploads.requeue(upload.id, upload.status === 'completed' ? 'completed' : 'failed');
  if (requeued) return { outcome: 'requeued', upload: requeued };
  // It changed since we read it (a retry from another tab, say): report it as it is now.
  const current = await deps.uploads.findById(id);
  return current ? { outcome: 'requeued', upload: current } : { outcome: 'not-found' };
}
