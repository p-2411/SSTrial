import type { UploadDetail, UploadSummary } from '@label-extractor/shared';
import { completeUpload, createUpload, putFileToStorage } from '@/api/uploads';
import { sha256Hex } from '@/lib/hashFile';

export interface UploadFileCallbacks {
  /** Share of the bytes sent to storage, 0–1. Can fire dozens of times a second. */
  onProgress: (fraction: number) => void;
  /** The bytes are in storage and the API is being told. */
  onConfirming: () => void;
}

export type UploadFileResult =
  | { kind: 'confirmed'; upload: UploadDetail }
  /** The server already has an identical file, so nothing was sent. */
  | { kind: 'duplicate'; upload: UploadSummary };

/**
 * Sends one file to the server: ask the API for a signed URL → PUT the bytes to storage (with
 * progress) → confirm with the API, which queues it for extraction. Throws if any step fails, with
 * a message fit to show.
 */
export async function uploadFile(file: File, { onProgress, onConfirming }: UploadFileCallbacks): Promise<UploadFileResult> {
  const created = await createUpload({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    // Lets the API recognise a file it already has, so it isn't uploaded or extracted twice.
    sha256: await sha256Hex(file),
  });
  if (created.kind === 'duplicate') return created;

  const { upload, uploadUrl } = created;
  // Use the API's normalised type: the browser's `file.type` can be empty or "image/jpg".
  await putFileToStorage(uploadUrl, file, upload.mimeType, onProgress);

  onConfirming();
  return { kind: 'confirmed', upload: await completeUpload(upload.id) };
}
