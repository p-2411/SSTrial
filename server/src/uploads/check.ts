import type { CurrentMember } from '@label-extractor/shared';
import { findAllVisible } from './access.ts';
import { applyEdit, type EditDeps } from './edit.ts';
import { fieldsToCheck } from './presenter.ts';
import type { UploadQueries, UploadRecord } from './store.ts';

export interface CheckDeps extends EditDeps {
  uploads: EditDeps['uploads'] & Pick<UploadQueries, 'findByIds'>;
}

/**
 * "Mark all as checked" in Review: confirms every flagged field of each upload as right, as the
 * person asking, just as each one's own "Mark as checked" would (through applyEdit, so each is
 * saved as a version and recorded in the log). Uploads they can't see, or with nothing flagged,
 * are left alone, and so is one that changes in between: its new flags haven't been looked at.
 */
export async function checkFlaggedFields(
  deps: CheckDeps,
  ids: readonly string[],
  person: Pick<CurrentMember, 'id' | 'email' | 'role'>,
): Promise<UploadRecord[]> {
  const checked: UploadRecord[] = [];
  for (const upload of await findAllVisible(deps.uploads, ids, person)) {
    const fields = fieldsToCheck(upload);
    if (fields.length === 0) continue;
    const result = await applyEdit(deps, upload, { revision: upload.resultRevision, checked: fields }, person);
    if (result.outcome === 'saved') checked.push(result.upload);
  }
  return checked;
}
