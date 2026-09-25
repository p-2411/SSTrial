import {
  UPLOAD_FILTER_IDS,
  UPLOAD_FILTERS,
  uploadErrorMessage,
  type UploadCountsResponse,
  type UploadDetail,
  type UploadStatus,
  type UploadSummary,
} from '@label-extractor/shared';
import { RETRY_POLICY } from '../extraction/retry-policy.ts';
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
    maxAttempts: RETRY_POLICY.maxAttempts,
    // The message is rendered from the code at response time, so rewording never touches stored data.
    error: record.error && { code: record.error.code, message: uploadErrorMessage(record.error.code) },
    productName: record.result?.productName ?? null,
    resultUnreadable: record.resultUnreadable,
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

/** How many uploads each list view holds, from the per-status counts. */
export function toUploadCounts(byStatus: Partial<Record<UploadStatus, number>>): UploadCountsResponse {
  const total = (statuses: readonly UploadStatus[]) => statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
  return {
    counts: Object.fromEntries(UPLOAD_FILTER_IDS.map((id) => [id, total(UPLOAD_FILTERS[id])])) as UploadCountsResponse['counts'],
  };
}
