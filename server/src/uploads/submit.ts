import { canSubmitUpload, type CurrentMember } from '@label-extractor/shared';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import { findAllVisible } from './access.ts';
import { toUploadSummary } from './presenter.ts';
import type { UploadQueries, UploadRecord, UploadReviews } from './store.ts';

export interface SubmitDeps {
  uploads: Pick<UploadQueries, 'findByIds'> & Pick<UploadReviews, 'submit'>;
  events: EventLog;
}

/**
 * The uploader putting read uploads into Products, the shared record everyone sees. Only those
 * with nothing left to check go in (see canSubmitUpload): a field the model wasn't confident
 * about must be checked, or corrected, by a person first. Each goes in as the data that was
 * judged ready: if it changes in between, it stays in Review. Any that can't go in are skipped,
 * so a batch submits everything that's ready. All are read at once, and go in at once.
 */
export async function submitUploads(
  deps: SubmitDeps,
  ids: readonly string[],
  person: Pick<CurrentMember, 'id' | 'email' | 'role'>,
): Promise<UploadRecord[]> {
  // Only the uploader's: until it's submitted, nobody else can see it (see canViewUpload).
  const ready = (await findAllVisible(deps.uploads, ids, person)).filter(
    (upload) => upload.uploadedBy === person.id && canSubmitUpload(toUploadSummary(upload)),
  );
  const judged = ready.map((upload) => ({ id: upload.id, revision: upload.resultRevision }));
  const saved = new Map((await deps.uploads.submit(judged, person.id)).map((upload) => [upload.id, upload]));
  const submitted = ready.flatMap((upload) => saved.get(upload.id) ?? []);
  await deps.events.record(...submitted.map((upload) => logEvents.uploadSubmitted(upload, person.email)));
  return submitted;
}
