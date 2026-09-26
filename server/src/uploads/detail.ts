import type { CurrentMember, UploadDetail } from '@label-extractor/shared';
import type { MemberStore } from '../auth/members.ts';
import type { FileStorage } from '../infra/storage.ts';
import type { Logger } from '../infra/logger.ts';
import { peopleIn, toUploadDetail } from './presenter.ts';
import type { UploadRecord } from './store.ts';

/** How long preview links in the detail view stay valid. */
const PREVIEW_URL_TTL_SECONDS = 10 * 60;

export interface DetailDeps {
  storage: Pick<FileStorage, 'createDownloadUrl'>;
  /** To name who uploaded the file and who reviewed its fields. */
  members: Pick<MemberStore, 'emailsOf'>;
  log: Pick<Logger, 'warn'>;
  /** Who's asking: what they may do with it (delete it, say) depends on who they are. */
  viewer: Pick<CurrentMember, 'id' | 'role'>;
}

/**
 * Everything the detail view shows for an upload: its data, who's who, and a short-lived link to
 * preview the file. A storage hiccup shouldn't hide the data, so a failed link is just left out.
 */
export async function loadUploadDetail(deps: DetailDeps, upload: UploadRecord): Promise<UploadDetail> {
  if (upload.resultUnreadable) {
    deps.log.warn({ uploadId: upload.id }, 'Stored result no longer matches the extraction schema');
  }
  const [fileUrl, emails] = await Promise.all([
    upload.status === 'uploading'
      ? null
      : deps.storage.createDownloadUrl(upload.storagePath, PREVIEW_URL_TTL_SECONDS).catch((err: unknown) => {
          deps.log.warn({ err, uploadId: upload.id }, 'Could not create preview URL');
          return null;
        }),
    deps.members.emailsOf(peopleIn(upload)),
  ]);
  return toUploadDetail(upload, fileUrl, emails, deps.viewer);
}
