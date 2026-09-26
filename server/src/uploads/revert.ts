import { canTransition, type CurrentMember, type RevertRequest } from '@label-extractor/shared';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import type { UploadQueries, UploadRecord, UploadReviews } from './store.ts';

export type RevertOutcome =
  | { outcome: 'reverted'; upload: UploadRecord }
  /** Someone changed the upload since the person looked at it: nothing was written. */
  | { outcome: 'conflict' }
  /** Only a completed upload's data can be put back. */
  | { outcome: 'not-revertible' }
  /** No such upload, or no such version of it. */
  | { outcome: 'not-found' };

export interface RevertDeps {
  uploads: Pick<UploadQueries, 'findById' | 'listVersions'> & Pick<UploadReviews, 'revert'>;
  events: EventLog;
}

/**
 * Puts a completed upload's data back to a saved version (an admin's "Revert to here" in its
 * history): the result, the scores it had then, and who had reviewed what, so checks made since
 * are undone. Nothing is erased: the revert is itself a new version and a history entry, so it
 * can be reverted too. Made against the revision the admin saw, like an edit, so it can't undo a
 * change they haven't seen.
 */
export async function revertUpload(
  deps: RevertDeps,
  id: string,
  request: RevertRequest,
  admin: Pick<CurrentMember, 'email'>,
): Promise<RevertOutcome> {
  const upload = await deps.uploads.findById(id);
  if (!upload) return { outcome: 'not-found' };
  if (!canTransition('review', upload.status)) return { outcome: 'not-revertible' };
  const to = (await deps.uploads.listVersions(id)).find((version) => version.id === request.versionId);
  if (!to) return { outcome: 'not-found' };

  const reverted = await deps.uploads.revert(id, request.revision, to.id);
  if (!reverted) return { outcome: 'conflict' };
  await deps.events.record(logEvents.uploadReverted(reverted.upload, { by: admin.email, to, versionId: reverted.versionId }));
  return { outcome: 'reverted', upload: reverted.upload };
}
