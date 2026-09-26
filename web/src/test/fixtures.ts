import type { LogEvent, UploadDetail, UploadHistoryEntry, UploadSummary } from '@label-extractor/shared';

/** An upload as a list gets it. A completed one is in Products unless `submittedAt: null` says it's in Review. */
export function summary(overrides: Partial<UploadSummary> = {}): UploadSummary {
  const status = overrides.status ?? 'completed';
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
    submittedAt: status === 'completed' ? new Date().toISOString() : null,
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
    canRevert: false,
    ...overrides,
  };
}

/** The upload most events below are about. */
export const EVENT_UPLOAD_ID = '9e1b7c2a-0000-4000-8000-000000000001';

/** An event in the activity log: an everyday one about EVENT_UPLOAD_ID, unless overridden. */
export function logEvent(overrides: Partial<LogEvent> & Pick<LogEvent, 'id' | 'message'>): LogEvent {
  return {
    occurredAt: new Date().toISOString(),
    source: 'worker',
    level: 'info',
    type: 'extraction.started',
    uploadId: EVENT_UPLOAD_ID,
    fileName: 'oat-milk.png',
    hasDetails: false,
    ...overrides,
  };
}

/** An entry in an upload's history: an everyday one, with nothing to revert to, unless overridden. */
export function historyEntry(id: string, message: string, overrides: Partial<UploadHistoryEntry> = {}): UploadHistoryEntry {
  return {
    id,
    occurredAt: new Date().toISOString(),
    source: 'api',
    level: 'info',
    type: 'upload.created',
    uploadId: 'u1',
    message,
    fileName: 'label.png',
    hasDetails: false,
    revertTo: null,
    ...overrides,
  };
}
