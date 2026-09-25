import { pino } from 'pino';
import type { LabelExtraction, SupportedMimeType, UploadErrorCode } from '@label-extractor/shared';
import { StorageUnavailableError, type FileStorage } from '../src/infra/storage.ts';
import type { NewUpload, UploadRecord, UploadStore } from '../src/uploads/store.ts';

/**
 * In-memory stand-ins for Postgres, the queue and Supabase Storage, so API and worker logic can be
 * tested fast and deterministically. The real implementations are covered by the integration test.
 */

export const silentLogger = pino({ level: 'silent' });

export const SAMPLE_EXTRACTION: LabelExtraction = {
  productName: 'Maple Pecan Crunch',
  brand: 'Harvest & Hearth',
  ingredients: [
    { name: 'Rolled oats', percent: 48, subIngredients: [], allergens: ['oats'] },
    { name: 'Pecans', percent: 10, subIngredients: [], allergens: ['pecans'] },
    { name: 'Puffed rice', percent: null, subIngredients: ['rice', 'salt'], allergens: [] },
  ],
  allergens: ['oats', 'pecans'],
  netWeight: { value: 500, unit: 'g', text: 'Net Wt 500 g' },
};

/** Mirrors the guarded transitions in src/uploads/store.ts, and records enqueued jobs. */
export class InMemoryUploadStore implements UploadStore {
  readonly rows = new Map<string, UploadRecord>();
  /** Upload IDs an extraction job was enqueued for, in order. */
  readonly enqueued: string[] = [];
  /** Upload IDs a finalise job was scheduled for, in order. */
  readonly finaliseScheduled: string[] = [];

  seed(overrides: Partial<UploadRecord> & { id: string }): UploadRecord {
    const now = new Date();
    const record: UploadRecord = {
      fileName: 'label.png',
      mimeType: 'image/png',
      sizeBytes: 1234,
      storagePath: `uploads/${overrides.id}.png`,
      contentSha256: null,
      status: 'uploading',
      attempts: 0,
      error: null,
      result: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      ...overrides,
    };
    this.rows.set(record.id, record);
    return record;
  }

  get(id: string): UploadRecord {
    const row = this.rows.get(id);
    if (!row) throw new Error(`No upload ${id}`);
    return row;
  }

  async create(upload: NewUpload) {
    this.finaliseScheduled.push(upload.id);
    return this.seed({ ...upload });
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByContentHash(sha256: string) {
    return this.newest((row) => row.contentSha256 === sha256 && ['queued', 'processing', 'completed'].includes(row.status));
  }
  async recordContentHash(id: string, sha256: string) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, contentSha256: sha256 });
  }
  async findCompletedTwin(sha256: string, excludeId: string) {
    return this.newest((row) => row.contentSha256 === sha256 && row.status === 'completed' && row.id !== excludeId);
  }
  private newest(predicate: (row: UploadRecord) => boolean) {
    return [...this.rows.values()].filter(predicate).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }
  async listRecent(limit: number) {
    return [...this.rows.values()]
      .filter((row) => row.status !== 'uploading')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async *streamCompleted() {
    const completed = [...this.rows.values()]
      .filter((row) => row.status === 'completed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    yield* completed;
  }
  async markUploaded(id: string, mimeType: SupportedMimeType) {
    const row = this.transition(id, ['uploading'], { status: 'queued', mimeType });
    if (row) this.enqueued.push(id);
    return row;
  }
  async discardUnfinished(id: string) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'uploading') return null;
    this.rows.delete(id);
    return row;
  }
  async requeueFailed(id: string) {
    const row = this.transition(id, ['failed'], { status: 'queued', attempts: 0, error: null });
    if (row) this.enqueued.push(id);
    return row;
  }
  async startAttempt(id: string) {
    const row = this.rows.get(id);
    return this.transition(id, ['queued', 'processing'], {
      status: 'processing',
      attempts: (row?.attempts ?? 0) + 1,
      error: null,
    });
  }
  async complete(id: string, result: LabelExtraction) {
    return this.transition(id, ['processing'], { status: 'completed', result, error: null, completedAt: new Date() });
  }
  async scheduleRetry(id: string, code: UploadErrorCode) {
    return this.transition(id, ['processing'], { status: 'queued', error: { code } });
  }
  async fail(id: string, code: UploadErrorCode) {
    return this.transition(id, ['queued', 'processing'], { status: 'failed', error: { code } });
  }

  private transition(id: string, from: UploadRecord['status'][], changes: Partial<UploadRecord>) {
    const row = this.rows.get(id);
    if (!row || !from.includes(row.status)) return null;
    const updated = { ...row, ...changes, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }
}

/** Files keyed by path. Set `unavailable` to simulate a storage outage. */
export class InMemoryStorage implements FileStorage {
  readonly files = new Map<string, Uint8Array>();
  unavailable = false;

  put(path: string, bytes: Uint8Array | string) {
    this.files.set(path, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
  }

  async createUploadUrl(path: string) {
    this.assertAvailable();
    return `https://storage.test/upload/${path}?token=signed`;
  }
  async createDownloadUrl(path: string) {
    this.assertAvailable();
    return this.files.has(path) ? `https://storage.test/download/${path}?token=signed` : null;
  }
  async readHead(path: string, byteCount: number) {
    this.assertAvailable();
    return this.files.get(path)?.subarray(0, byteCount) ?? null;
  }
  async remove(path: string) {
    this.assertAvailable();
    this.files.delete(path);
  }
  async download(path: string) {
    this.assertAvailable();
    return this.files.get(path) ?? null;
  }

  private assertAvailable() {
    if (this.unavailable) throw new StorageUnavailableError('Storage is down (simulated)');
  }
}

/** Leading bytes of each supported type, enough for magic-byte detection. */
export const FILE_BYTES = {
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  pdf: new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n'),
  text: new TextEncoder().encode('Just some text pretending to be an image.'),
};
