import { canSubmitUpload, type CurrentMember } from '@label-extractor/shared';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import { toUploadSummary } from './presenter.ts';
import type { UploadQueries, UploadRecord, UploadReviews } from './store.ts';

export interface SubmitDeps {
  uploads: Pick<UploadQueries, 'findById'> & Pick<UploadReviews, 'submit'>;
  events: EventLog;
}

/**
 * The uploader putting read uploads into Products, the shared record everyone sees. Only those
 * with nothing left to check go in (see canSubmitUpload): a field the model wasn't confident
 * about must be checked, or corrected, by a person first. Each goes in as the data that was
 * judged ready: if it changes in between, it stays in Review. Any that can't go in are skipped,
 * so a batch submits everything that's ready.
 */
export async function submitUploads(
  deps: SubmitDeps,
  ids: readonly string[],
  person: Pick<CurrentMember, 'id' | 'email'>,
): Promise<UploadRecord[]> {
  const submitted: UploadRecord[] = [];
  for (const id of new Set(ids)) {
    const upload = await deps.uploads.findById(id);
    // Only the uploader's: until it's submitted, nobody else can see it (see canViewUpload).
    if (!upload || upload.uploadedBy !== person.id || !canSubmitUpload(toUploadSummary(upload))) continue;
    const saved = await deps.uploads.submit(id, upload.resultRevision, person.id);
    if (!saved) continue;
    await deps.events.record(logEvents.uploadSubmitted(saved, person.email));
    submitted.push(saved);
  }
  return submitted;
}
