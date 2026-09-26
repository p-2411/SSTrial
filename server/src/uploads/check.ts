import { canViewUpload, type CurrentMember } from '@label-extractor/shared';
import { editResult, type EditDeps } from './edit.ts';
import { fieldsToCheck, visibilityOf } from './presenter.ts';
import type { UploadRecord } from './store.ts';

/**
 * "Mark all as checked" in Review: confirms every flagged field of each upload as right, as the
 * person asking, just as each one's own "Mark as checked" would (through editResult, so each is
 * saved as a version and recorded in the log). Uploads they can't see, or with nothing flagged,
 * are left alone, and so is one that changes in between: its new flags haven't been looked at.
 */
export async function checkFlaggedFields(
  deps: EditDeps,
  ids: readonly string[],
  person: Pick<CurrentMember, 'id' | 'email' | 'role'>,
): Promise<UploadRecord[]> {
  const checked: UploadRecord[] = [];
  for (const id of new Set(ids)) {
    const upload = await deps.uploads.findById(id);
    if (!upload || !canViewUpload(visibilityOf(upload), person)) continue;
    const fields = fieldsToCheck(upload);
    if (fields.length === 0) continue;
    const result = await editResult(deps, id, { revision: upload.resultRevision, checked: fields }, person);
    if (result.outcome === 'saved') checked.push(result.upload);
  }
  return checked;
}
