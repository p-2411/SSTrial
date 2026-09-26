import { canDeleteUpload, canTransition, type CurrentMember } from '@label-extractor/shared';
import type { FileStorage } from '../infra/storage.ts';
import { logEvents } from '../logs/events.ts';
import type { TransactionalEventLog } from '../logs/store.ts';
import { findAllVisible, ownershipOf } from './access.ts';
import type { UploadQueries, UploadRecord, UploadRemoval } from './store.ts';

/**
 * Someone deleting uploads: each one's file and row go for good. Its activity-log history stays
 * (events aren't tied to the row, see logs/store.ts), with who deleted it and the product's data,
 * recorded in the same transaction as the delete: that event is the only record left of what was
 * deleted, so neither happens without the other.
 *
 * An extraction in progress needs no stopping: once the row is gone, that attempt's writes are
 * refused (as when another attempt takes an upload over) and its job ends.
 */

export interface DeleteReport {
  /** Deleted, file and all, in the order they were named. */
  deleted: UploadRecord[];
  /** Ones the asker can see but may not delete: only whoever uploaded it, or an admin, may (see canDeleteUpload). */
  forbidden: string[];
  /**
   * The rest: ones that don't exist, or the asker can't see, or are still being uploaded (listed
   * nowhere, and settled by their finalise job), or that someone else deleted meanwhile.
   */
  notFound: string[];
}

export interface DeleteDeps {
  uploads: Pick<UploadQueries, 'findByIds'> & UploadRemoval;
  storage: Pick<FileStorage, 'remove'>;
  events: TransactionalEventLog;
}

type Person = Pick<CurrentMember, 'id' | 'email' | 'role'>;

/**
 * Deletes the uploads named that the asker may: all read at once, their files removed in one
 * request, then their rows in one transaction. Files first: if deleting the rows then fails,
 * asking again finds them and deletes the already-missing files without complaint (the other way
 * round could leave files with no upload). If storage can't be reached, this throws before any row
 * is touched, so the report is exact: what it says was deleted is gone, and nothing else is.
 */
export async function deleteUploads(deps: DeleteDeps, ids: readonly string[], person: Person): Promise<DeleteReport> {
  const deletable = (await findAllVisible(deps.uploads, ids, person)).filter((upload) => canTransition('delete', upload.status));
  const allowed = deletable.filter((upload) => canDeleteUpload(ownershipOf(upload), person));
  const forbidden = deletable.filter((upload) => !allowed.includes(upload)).map((upload) => upload.id);

  let removed: UploadRecord[] = [];
  if (allowed.length > 0) {
    await deps.storage.remove(allowed.map((upload) => upload.storagePath));
    removed = await deps.uploads.remove(
      allowed.map((upload) => upload.id),
      (gone, tx) => deps.events.recordIn(tx, gone.map((upload) => logEvents.uploadDeleted(upload, person.email))),
    );
  }

  const byId = new Map(removed.map((upload) => [upload.id, upload]));
  const deleted = allowed.flatMap((upload) => byId.get(upload.id) ?? []);
  const reported = new Set([...byId.keys(), ...forbidden]);
  return { deleted, forbidden, notFound: [...new Set(ids)].filter((id) => !reported.has(id)) };
}

export type DeleteOutcome =
  | { outcome: 'deleted'; upload: UploadRecord }
  | { outcome: 'forbidden' }
  | { outcome: 'not-found' };

/** Deleting one upload: the same, for one. */
export async function deleteUpload(deps: DeleteDeps, id: string, person: Person): Promise<DeleteOutcome> {
  const { deleted, forbidden } = await deleteUploads(deps, [id], person);
  if (deleted[0]) return { outcome: 'deleted', upload: deleted[0] };
  return forbidden.length > 0 ? { outcome: 'forbidden' } : { outcome: 'not-found' };
}
