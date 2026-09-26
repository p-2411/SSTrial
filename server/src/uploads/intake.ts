import {
  SUPPORTED_FILE_TYPES,
  validateFileMetadata,
  type CreateUploadRequest,
  type CurrentMember,
  type FileValidationErrorCode,
  type SupportedMimeType,
} from '@label-extractor/shared';
import type { FileStorage } from '../infra/storage.ts';
import { logEvents } from '../logs/events.ts';
import type { EventLog } from '../logs/store.ts';
import type { UploadIntake, UploadQueries, UploadRecord } from './store.ts';

/**
 * Step 1 of an upload: check the file's details, then either point at an identical file we already
 * have, or create the upload and a signed URL the browser sends the bytes to.
 */

export type UploadRequestResult =
  | { outcome: 'created'; upload: UploadRecord; uploadUrl: string }
  /** An identical file is already queued, processing or done. */
  | { outcome: 'duplicate'; upload: UploadRecord }
  | { outcome: 'invalid'; code: FileValidationErrorCode; message: string };

export interface IntakeDeps {
  uploads: Pick<UploadQueries, 'findByContentHash'> & Pick<UploadIntake, 'create'>;
  storage: Pick<FileStorage, 'createUploadUrl'>;
  events: EventLog;
}

export async function requestUpload(
  deps: IntakeDeps,
  request: CreateUploadRequest,
  uploader: Pick<CurrentMember, 'id' | 'email'>,
): Promise<UploadRequestResult> {
  // Same rules the browser already applied — the browser can't be trusted to have done so.
  const validation = validateFileMetadata({ name: request.fileName, type: request.mimeType, size: request.sizeBytes });
  if (!validation.ok) return { outcome: 'invalid', code: validation.code, message: validation.message };

  // The hash is the browser's claim; the worker checks the real bytes before reusing any result.
  if (request.sha256) {
    const existing = await deps.uploads.findByContentHash(request.sha256);
    if (existing) {
      await deps.events.record(logEvents.uploadDuplicate(existing, request.fileName.trim()));
      return { outcome: 'duplicate', upload: existing };
    }
  }

  const id = crypto.randomUUID();
  const storagePath = storagePathFor(id, validation.mimeType);
  // Get the URL before inserting, so a storage outage doesn't leave an orphaned row behind.
  const uploadUrl = await deps.storage.createUploadUrl(storagePath);
  const upload = await deps.uploads.create({
    id,
    fileName: request.fileName.trim(),
    mimeType: validation.mimeType,
    sizeBytes: request.sizeBytes,
    storagePath,
    contentSha256: request.sha256 ?? null,
    uploadedBy: uploader.id,
  });
  await deps.events.record(logEvents.uploadCreated(upload, uploader.email));
  return { outcome: 'created', upload, uploadUrl };
}

/** The object key is ours, never the user's file name: no path tricks, no unicode surprises. */
function storagePathFor(id: string, mimeType: SupportedMimeType): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${day}/${id}${SUPPORTED_FILE_TYPES[mimeType].extensions[0]}`;
}
