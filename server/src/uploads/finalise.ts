import { detectFileType, SIGNATURE_BYTES } from '../infra/file-signature.ts';
import type { FileStorage } from '../infra/storage.ts';
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
 * Whichever runs first wins; the other finds the upload already finalised.
 */

export type FinaliseResult =
  /** The file checked out and extraction is queued. */
  | { outcome: 'queued'; upload: UploadRecord }
  /** Already finalised by the other caller (or a duplicate request). */
  | { outcome: 'already-finalised'; upload: UploadRecord }
  /** No file in storage (yet). */
  | { outcome: 'not-uploaded' }
  /** The bytes aren't a supported type. The file and the upload have been deleted — nothing is kept. */
  | { outcome: 'rejected' }
  | { outcome: 'not-found' };

export interface FinaliseDeps {
  uploads: Pick<UploadStore, 'findById' | 'markUploaded' | 'discardUnfinished'>;
  storage: Pick<FileStorage, 'readHead' | 'remove'>;
}

export async function finaliseUpload(deps: FinaliseDeps, id: string): Promise<FinaliseResult> {
  const upload = await deps.uploads.findById(id);
  if (!upload) return { outcome: 'not-found' };
  if (upload.status !== 'uploading') return { outcome: 'already-finalised', upload };

  const head = await deps.storage.readHead(upload.storagePath, SIGNATURE_BYTES);
  if (!head || head.length === 0) return { outcome: 'not-uploaded' };

  // The name and MIME type were claims; the bytes are the truth.
  const detected = detectFileType(head);
  if (!detected) {
    // Not something we'd ever process (e.g. a renamed .exe), so don't keep it. File first: if the
    // delete fails, the row survives and the finalise job tries again later.
    await deps.storage.remove(upload.storagePath);
    await deps.uploads.discardUnfinished(upload.id);
    return { outcome: 'rejected' };
  }

  // A valid file with the wrong extension (a PNG saved as .jpg) is accepted under its real type.
  const queued = await deps.uploads.markUploaded(upload.id, detected);
  if (queued) return { outcome: 'queued', upload: queued };

  // The other caller finalised it between our read and our update.
  const current = await deps.uploads.findById(id);
  return current ? { outcome: 'already-finalised', upload: current } : { outcome: 'not-found' };
}
