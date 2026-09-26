import {
  applyConfidenceChecks,
  canDeleteUpload,
  canTransition,
  type CurrentMember,
  flaggedFields,
  overallConfidence,
  type ExtractionConfidence,
  type LabelField,
  type FieldReviews,
  uploadErrorMessage,
  type UploadDetail,
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
    confidence: overallConfidence(checkedConfidence(record), reviewedFields(record.fieldReviews)),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    submittedAt: record.submittedAt?.toISOString() ?? null,
  };
}

/** What canViewUpload needs to know about an upload. */
export function visibilityOf(record: UploadRecord) {
  return { status: record.status, submitted: record.submittedAt !== null, uploaderId: record.uploadedBy };
}

/** The fields of a read upload still worth a person's look (see flaggedFields). */
export function fieldsToCheck(record: UploadRecord): LabelField[] {
  return flaggedFields(checkedConfidence(record), reviewedFields(record.fieldReviews));
}

/**
 * @param emails The email of each person the record mentions (uploader, reviewers), by user ID;
 *   see `peopleIn`. Someone whose account is gone reads as null.
 */
export function toUploadDetail(
  record: UploadRecord,
  fileUrl: string | null,
  emails: ReadonlyMap<string, string>,
  viewer: Pick<CurrentMember, 'id' | 'role'>,
): UploadDetail {
  const emailOf = (userId: string | null) => (userId ? (emails.get(userId) ?? null) : null);
  return {
    ...toUploadSummary(record),
    result: record.status === 'completed' ? record.result : null,
    fieldConfidence: checkedConfidence(record),
    fieldReviews: Object.fromEntries(
      Object.entries(record.fieldReviews).map(([field, review]) => [
        field,
        { kind: review.kind, by: emailOf(review.by), at: review.at.toISOString() },
      ]),
    ) as FieldReviews,
    revision: record.resultRevision,
    fileUrl,
    uploadedBy: emailOf(record.uploadedBy),
    canDelete: canDeleteUpload(record.uploadedBy, viewer),
    canRevert: viewer.role === 'admin' && canTransition('review', record.status),
  };
}

/** The user IDs a record mentions, to look up their emails for `toUploadDetail` (see uploads/detail.ts). */
export function peopleIn(record: UploadRecord): string[] {
  const ids = [record.uploadedBy, ...Object.values(record.fieldReviews).map((review) => review.by)];
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

/**
 * A completed upload's scores with the checks applied to its data as it is now, edits included, so
 * a flag never outlives the contradiction it was about (or misses one an edit introduced).
 */
function checkedConfidence(record: UploadRecord): ExtractionConfidence | null {
  if (record.status !== 'completed' || !record.result || !record.confidence) return null;
  return applyConfidenceChecks(record.result, record.confidence);
}

function reviewedFields(reviews: StoredFieldReviews): LabelField[] {
  return Object.keys(reviews) as LabelField[];
}
