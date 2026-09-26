import { canViewUpload, isProduct, type CurrentMember, type UploadOwnership } from '@label-extractor/shared';
import type { UploadQueries, UploadRecord } from './store.ts';

/**
 * Who may reach which upload. Every use case a person names an upload to (by its ID) looks it up
 * through here, so one rule decides (canViewUpload): an upload someone can't see doesn't exist, as
 * far as they're told, whatever they asked to do with it. Only then do the rules for what they may
 * do with it apply, so nobody learns of someone else's upload from being refused it.
 */

export type Person = Pick<CurrentMember, 'id' | 'role'>;

/** What the rules in shared/src/auth.ts need to know about an upload. */
export function ownershipOf(upload: UploadRecord): UploadOwnership {
  return { product: isProduct(upload), uploaderId: upload.uploadedBy };
}

/** The upload with this ID, if it exists and this person may see it; otherwise null. */
export async function findVisible(uploads: Pick<UploadQueries, 'findById'>, id: string, person: Person): Promise<UploadRecord | null> {
  const upload = await uploads.findById(id);
  return upload && canViewUpload(ownershipOf(upload), person) ? upload : null;
}

/**
 * The uploads with these IDs that exist and this person may see, read at once, each once, in the
 * order they were named. The rest are left out, as if they didn't exist.
 */
export async function findAllVisible(
  uploads: Pick<UploadQueries, 'findByIds'>,
  ids: readonly string[],
  person: Person,
): Promise<UploadRecord[]> {
  const unique = [...new Set(ids)];
  const found = new Map((await uploads.findByIds(unique)).map((upload) => [upload.id, upload]));
  return unique.flatMap((id) => {
    const upload = found.get(id);
    return upload && canViewUpload(ownershipOf(upload), person) ? [upload] : [];
  });
}
