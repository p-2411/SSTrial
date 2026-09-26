import {
  overallConfidence,
  type LabelField,
  type FieldReviews,
  UPLOAD_FILTER_IDS,
  UPLOAD_FILTERS,
  uploadErrorMessage,
  type UploadCountsResponse,
  type UploadDetail,
  type UploadStatus,
  type UploadSummary,
} from '@label-extractor/shared';
import { RETRY_POLICY } from '../extraction/retry-policy.ts';
import type { StoredFieldReviews, UploadRecord } from './store.ts';

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
    // Fields a person has already reviewed don't need checking any more.
    confidence: record.status === 'completed' ? overallConfidence(record.confidence, reviewedFields(record.fieldReviews)) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}

/**
 * @param emails The email of each person the record mentions (uploader, reviewers), by user ID;
 *   see `peopleIn`. Someone whose account is gone reads as null.
 */
export function toUploadDetail(record: UploadRecord, fileUrl: string | null, emails: ReadonlyMap<string, string | null>): UploadDetail {
  const emailOf = (userId: string | null) => (userId ? (emails.get(userId) ?? null) : null);
  return {
    ...toUploadSummary(record),
    result: record.status === 'completed' ? record.result : null,
    fieldConfidence: record.status === 'completed' ? record.confidence : null,
    fieldReviews: Object.fromEntries(
      Object.entries(record.fieldReviews).map(([field, review]) => [
        field,
        { kind: review.kind, by: emailOf(review.by), at: review.at.toISOString() },
      ]),
    ) as FieldReviews,
    revision: record.resultRevision,
    fileUrl,
    uploadedBy: emailOf(record.uploadedBy),
  };
}

/** The user IDs a record mentions, to look up their emails for `toUploadDetail`. */
export function peopleIn(record: UploadRecord): string[] {
  const ids = [record.uploadedBy, ...Object.values(record.fieldReviews).map((review) => review.by)];
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

function reviewedFields(reviews: StoredFieldReviews): LabelField[] {
  return Object.keys(reviews) as LabelField[];
}

/** How many uploads each list view holds, from the per-status counts. */
export function toUploadCounts(byStatus: Partial<Record<UploadStatus, number>>): UploadCountsResponse {
  const total = (statuses: readonly UploadStatus[]) => statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
  return {
    counts: Object.fromEntries(UPLOAD_FILTER_IDS.map((id) => [id, total(UPLOAD_FILTERS[id])])) as UploadCountsResponse['counts'],
  };
}
