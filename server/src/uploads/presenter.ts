import type { UploadDetail, UploadSummary } from '@label-extractor/shared';
import { MAX_EXTRACTION_ATTEMPTS } from '../infra/queue.ts';
import type { UploadRecord } from './store.ts';

/**
 * Converts internal records into the API's response shapes. Keeps storage details (like the
 * object path) out of responses, and turns Dates into ISO strings.
 */

export function toUploadSummary(record: UploadRecord): UploadSummary {
  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    status: record.status,
    attempts: record.attempts,
    maxAttempts: MAX_EXTRACTION_ATTEMPTS,
    error: record.error,
    productName: record.result?.productName ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}

export function toUploadDetail(record: UploadRecord, fileUrl: string | null): UploadDetail {
  return {
    ...toUploadSummary(record),
    result: record.status === 'completed' ? record.result : null,
    fileUrl,
  };
}
