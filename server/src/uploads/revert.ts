import { canRevertUpload, canTransition, type CurrentMember, type RevertRequest } from '@label-extractor/shared';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import { findVisible, ownershipOf } from './access.ts';
import type { UploadQueries, UploadRecord, UploadReviews } from './store.ts';

export type RevertOutcome =
  | { outcome: 'reverted'; upload: UploadRecord }
  /** Someone changed the upload since the person looked at it: nothing was written. */
  | { outcome: 'conflict' }
  /** Only a completed upload's data can be put back. */
  | { outcome: 'not-revertible' }
  /** Only admins can put data back (see canRevertUpload). */
  | { outcome: 'forbidden' }
  /** No such upload (or none this person can see), or no such version of it. */
  | { outcome: 'not-found' };

export interface RevertDeps {
  uploads: Pick<UploadQueries, 'findById' | 'findVersion'> & Pick<UploadReviews, 'revert'>;
  events: EventLog;
}

/**
 * Puts a completed upload's data back to a saved version (an admin's "Revert" in its
 * history): the result, the scores it had then, and who had reviewed what, so checks made since
 * are undone. Nothing is erased: the revert is itself a new version and a history entry, so it
 * can be reverted too. Made against the revision the admin saw, like an edit, so it can't undo a
 * change they haven't seen.
 *
 * A product stays in Products when it's reverted, even to a version with fields nobody had checked
 * then (the original reading, say): the admin chose that version. Those fields show as still to
 * check again, and anyone can check them in place, but nothing takes the product back out.
 */
export async function revertUpload(
  deps: RevertDeps,
  id: string,
  request: RevertRequest,
  person: Pick<CurrentMember, 'id' | 'email' | 'role'>,
): Promise<RevertOutcome> {
  const upload = await findVisible(deps.uploads, id, person);
  if (!upload) return { outcome: 'not-found' };
  if (!canRevertUpload(ownershipOf(upload), person)) return { outcome: 'forbidden' };
  if (!canTransition('review', upload.status)) return { outcome: 'not-revertible' };
  const to = await deps.uploads.findVersion(id, request.versionId);
  if (!to) return { outcome: 'not-found' };

  const reverted = await deps.uploads.revert(id, request.revision, to.id);
  if (!reverted) return { outcome: 'conflict' };
  await deps.events.record(logEvents.uploadReverted(reverted.upload, { by: person.email, to, versionId: reverted.versionId }));
  return { outcome: 'reverted', upload: reverted.upload };
}
