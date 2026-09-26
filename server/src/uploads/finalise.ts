import { detectFileType, SIGNATURE_BYTES } from '../infra/file-signature.ts';
import type { FileStorage } from '../infra/storage.ts';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import { findVisible, type Person } from './access.ts';
import type { UploadRecord, UploadStore } from './store.ts';

/**
 * Takes an upload out of `uploading`: checks the file that arrived and either queues it for
 * extraction or throws it away.
 *
 * Two callers, one outcome:
 *   - the browser, via POST /api/uploads/:id/complete, straight after its upload finishes;
 *   - the finalise job, once the signed upload URL has expired, for uploads the browser never
 *     confirmed (tab closed, connection lost). By then no more bytes can arrive, so an upload
 *     with no file is discarded for good.
 * Whichever runs first wins; the other finds the upload already finalised. When the browser wins,
 * the finalise job is cancelled in the same transaction, so it never runs just to find nothing to do.
 */

export type FinaliseResult =
  /** The file checked out and extraction is queued. */
  | { outcome: 'queued'; upload: UploadRecord }
  /** Already finalised by the other caller (or a duplicate request). */
  | { outcome: 'already-finalised'; upload: UploadRecord }
  /** No file in storage yet. The browser may still send it, so the upload is left as it is. */
  | { outcome: 'not-uploaded' }
  /** No file, and the upload URL has expired so none can arrive: the upload has been deleted. */
  | { outcome: 'discarded' }
  /** The bytes aren't a supported type. The file and the upload have been deleted — nothing is kept. */
  | { outcome: 'rejected' }
  | { outcome: 'not-found' };

export interface FinaliseDeps {
  uploads: Pick<UploadStore, 'findById' | 'markUploaded' | 'discardUnfinished'>;
  storage: Pick<FileStorage, 'readHead' | 'remove'>;
  events: EventLog;
}

/**
 * The browser's confirmation cancels the finalise job (the job can't cancel its own run), and only
 * the person who uploaded the file can send it: to anyone else, there's no such upload to confirm.
 * The finalise job runs after the upload URL has expired, so for it, no file means none will come.
 */
export type FinaliseOptions = { caller: 'browser'; person: Person } | { caller: 'finalise-job' };

export async function finaliseUpload(deps: FinaliseDeps, id: string, options: FinaliseOptions): Promise<FinaliseResult> {
  const { caller } = options;
  const settle = { cancelFinalise: caller === 'browser' };
  const upload = caller === 'browser' ? await findVisible(deps.uploads, id, options.person) : await deps.uploads.findById(id);
  if (!upload || (caller === 'browser' && upload.uploadedBy !== options.person.id)) return { outcome: 'not-found' };
  if (upload.status !== 'uploading') return { outcome: 'already-finalised', upload };

  const head = await deps.storage.readHead(upload.storagePath, SIGNATURE_BYTES);
  if (!head || head.length === 0) {
    if (caller === 'browser') return { outcome: 'not-uploaded' };
    // Only log what this call actually did: a concurrent confirmation may have got there first.
    if (await deps.uploads.discardUnfinished(upload.id)) await deps.events.record(logEvents.uploadDiscarded(upload));
    return { outcome: 'discarded' };
  }

  // The name and MIME type were claims; the bytes are the truth.
  const detected = detectFileType(head);
  if (!detected) {
    // Not something we'd ever process (e.g. a renamed .exe), so don't keep it. File first: if the
    // delete fails, the row survives and the finalise job tries again later.
    await deps.storage.remove([upload.storagePath]);
    if (await deps.uploads.discardUnfinished(upload.id, settle)) await deps.events.record(logEvents.uploadRejected(upload));
    return { outcome: 'rejected' };
  }

  // A valid file with the wrong extension (a PNG saved as .jpg) is accepted under its real type.
  const queued = await deps.uploads.markUploaded(upload.id, detected, settle);
  if (queued) {
    await deps.events.record(
      logEvents.uploadQueued(queued, { byFinaliseJob: caller === 'finalise-job', claimedType: upload.mimeType }),
    );
    return { outcome: 'queued', upload: queued };
  }

  // The other caller finalised it between our read and our update.
  const current = await deps.uploads.findById(id);
  return current ? { outcome: 'already-finalised', upload: current } : { outcome: 'not-found' };
}
