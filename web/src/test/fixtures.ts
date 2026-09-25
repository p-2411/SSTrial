import type { UploadSummary } from '@label-extractor/shared';

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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}
