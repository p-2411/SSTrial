import { canDeleteUpload, canRetryUpload, type CurrentMember } from '@label-extractor/shared';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import { findVisible, ownershipOf } from './access.ts';
import type { UploadIntake, UploadQueries, UploadRecord } from './store.ts';

export type RetryResult =
  | { outcome: 'requeued'; upload: UploadRecord }
  /** Nothing to gain from running it again (see canRetryUpload). */
  | { outcome: 'not-retryable'; upload: UploadRecord }
  /** Only whoever uploaded it, or an admin, may have it read again. */
  | { outcome: 'forbidden' }
  | { outcome: 'not-found' };

export interface RetryDeps {
  uploads: Pick<UploadQueries, 'findById'> & Pick<UploadIntake, 'requeue'>;
  events: EventLog;
}

/**
 * Runs extraction again for a failed upload, or a completed one whose result can no longer be read.
 * Reading a product again takes it out of Products until it's reviewed again, so it's for the same
 * people as deleting it (see canDeleteUpload), not everyone who can see it. An upload from before
 * sign-in becomes the asker's, so the new reading reaches someone's Review list.
 */
export async function retryUpload(
  deps: RetryDeps,
  id: string,
  person: Pick<CurrentMember, 'id' | 'email' | 'role'>,
): Promise<RetryResult> {
  const upload = await findVisible(deps.uploads, id, person);
  if (!upload) return { outcome: 'not-found' };
  if (!canDeleteUpload(ownershipOf(upload), person)) return { outcome: 'forbidden' };
  if (!canRetryUpload(upload)) return { outcome: 'not-retryable', upload };

  const requeued = await deps.uploads.requeue(upload.id, upload.status === 'completed' ? 'completed' : 'failed', person.id);
  if (requeued) {
    await deps.events.record(logEvents.retryRequested(requeued, person.email));
    return { outcome: 'requeued', upload: requeued };
  }
  // It changed since we read it (a retry from another tab, say): report it as it is now.
  const current = await findVisible(deps.uploads, id, person);
  return current ? { outcome: 'requeued', upload: current } : { outcome: 'not-found' };
}
