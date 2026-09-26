import type { UploadDetail, UploadSummary } from '@label-extractor/shared';

export function summary(overrides: Partial<UploadSummary> = {}): UploadSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fileName: 'granola-label.png',
    mimeType: 'image/png',
    sizeBytes: 50_000,
    status: 'completed',
    attempts: 1,
    maxAttempts: 5,
    error: null,
    productName: 'Maple Pecan Crunch',
    resultUnreadable: false,
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** An upload as the detail view gets it: a summary plus the detail-only fields, none of them set. */
export function detail(overrides: Partial<UploadDetail> = {}): UploadDetail {
  return {
    ...summary(),
    result: null,
    fieldConfidence: null,
    fieldReviews: {},
    revision: 0,
    fileUrl: null,
    uploadedBy: null,
    canDelete: false,
    ...overrides,
  };
}
