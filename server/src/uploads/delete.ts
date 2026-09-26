import { canDeleteUpload, canTransition, type CurrentMember } from '@label-extractor/shared';
import type { FileStorage } from '../infra/storage.ts';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import { findVisible, ownershipOf } from './access.ts';
import type { UploadQueries, UploadRecord, UploadRemoval } from './store.ts';

/**
 * Someone deleting an upload: its file and its row go for good. Its activity-log history stays,
 * with who deleted it (events aren't tied to the row, see logs/store.ts).
 *
 * An extraction in progress needs no stopping: once the row is gone, that attempt's writes are
 * refused (as when another attempt takes an upload over) and its job ends.
 */

export type DeleteOutcome =
  | { outcome: 'deleted'; upload: UploadRecord }
  /** Only whoever uploaded it, or an admin, may delete it (see canDeleteUpload). */
  | { outcome: 'forbidden' }
  | { outcome: 'not-found' };

export interface DeleteDeps {
  uploads: Pick<UploadQueries, 'findById'> & UploadRemoval;
  storage: Pick<FileStorage, 'remove'>;
  events: EventLog;
}

export async function deleteUpload(
  deps: DeleteDeps,
  id: string,
  person: Pick<CurrentMember, 'id' | 'email' | 'role'>,
): Promise<DeleteOutcome> {
  const upload = await findVisible(deps.uploads, id, person);
  // One still being uploaded isn't listed anywhere, so there's nothing anyone could have asked to delete.
  if (!upload || !canTransition('delete', upload.status)) return { outcome: 'not-found' };
  if (!canDeleteUpload(ownershipOf(upload), person)) return { outcome: 'forbidden' };

  // The file first: if deleting the row then fails, asking again finds the row and deletes the
  // already-missing file without complaint. The other way round could leave a file with no upload.
  await deps.storage.remove(upload.storagePath);
  const removed = await deps.uploads.remove(id);
  if (!removed) return { outcome: 'not-found' }; // someone else deleted it meanwhile

  await deps.events.record(logEvents.uploadDeleted(removed, person.email));
  return { outcome: 'deleted', upload: removed };
}
