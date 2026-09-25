import { pino } from 'pino';
import type { HealthReport, LabelExtraction, SupportedMimeType, UploadErrorCode } from '@label-extractor/shared';
import type { AppDeps } from '../src/api/app.ts';
import type { UploadChange } from '@label-extractor/shared';
import type { UploadChangeFeed } from '../src/uploads/change-feed.ts';
import type { OpsSnapshot } from '../src/ops/store.ts';
import { RateLimitWaitTooLong, type RateLimiter } from '../src/extraction/rate-limiter.ts';
import { StorageUnavailableError, type FileStorage } from '../src/infra/storage.ts';
import type { NewUpload, SettleOptions, UploadRecord, UploadStore } from '../src/uploads/store.ts';

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
  /** Upload IDs whose finalise job was cancelled, in order. */
  readonly finaliseCancelled: string[] = [];

  seed(overrides: Partial<UploadRecord> & { id: string }): UploadRecord {
    const now = new Date();
    const record: UploadRecord = {
      fileName: 'label.png',
      mimeType: 'image/png',
      sizeBytes: 1234,
      storagePath: `uploads/${overrides.id}.png`,
      contentSha256: null,
      claimToken: null,
      status: 'uploading',
      attempts: 0,
      error: null,
      result: null,
      resultUnreadable: false,
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
  async list({ statuses, limit, after }: { statuses: readonly UploadRecord['status'][]; limit: number; after?: string }) {
    const newestFirst = [...this.rows.values()]
      .filter((row) => statuses.includes(row.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const start = after ? newestFirst.findIndex((row) => row.id === after) + 1 : 0;
    return newestFirst.slice(start, start + limit);
  }
  async countByStatus() {
    const counts: Partial<Record<UploadRecord['status'], number>> = {};
    for (const row of this.rows.values()) if (row.status !== 'uploading') counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }
  async *streamCompleted() {
    const completed = [...this.rows.values()]
      .filter((row) => row.status === 'completed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    yield* completed;
  }
  async markUploaded(id: string, mimeType: SupportedMimeType, options?: SettleOptions) {
    const row = this.transition(id, ['uploading'], { status: 'queued', mimeType });
    if (row) this.enqueued.push(id);
    if (row && options?.cancelFinalise) this.finaliseCancelled.push(id);
    return row;
  }
  async discardUnfinished(id: string, options?: SettleOptions) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'uploading') return null;
    this.rows.delete(id);
    if (options?.cancelFinalise) this.finaliseCancelled.push(id);
    return row;
  }
  async requeue(id: string, from: 'failed' | 'completed') {
    const row = this.transition(id, [from], {
      status: 'queued',
      attempts: 0,
      error: null,
      result: null,
      resultUnreadable: false,
      completedAt: null,
      claimToken: null,
    });
    if (row) this.enqueued.push(id);
    return row;
  }
  async startAttempt(id: string) {
    const row = this.rows.get(id);
    return this.transition(id, ['queued', 'processing'], {
      status: 'processing',
      attempts: (row?.attempts ?? 0) + 1,
      error: null,
      claimToken: crypto.randomUUID(),
    });
  }
  async complete(id: string, claimToken: string, result: LabelExtraction) {
    return this.transition(id, ['processing'], { status: 'completed', result, error: null, completedAt: new Date(), claimToken: null }, claimToken);
  }
  async scheduleRetry(id: string, claimToken: string, code: UploadErrorCode) {
    return this.transition(id, ['processing'], { status: 'queued', error: { code }, claimToken: null }, claimToken);
  }
  async fail(id: string, claimToken: string, code: UploadErrorCode) {
    return this.transition(id, ['processing'], { status: 'failed', error: { code }, claimToken: null }, claimToken);
  }
  async failAbandoned(id: string, code: UploadErrorCode) {
    return this.transition(id, ['queued', 'processing'], { status: 'failed', error: { code }, claimToken: null });
  }

  /** A guarded update: only from the given statuses and, when `claimToken` is given, only if it's current. */
  private transition(id: string, from: UploadRecord['status'][], changes: Partial<UploadRecord>, claimToken?: string) {
    const row = this.rows.get(id);
    if (!row || !from.includes(row.status)) return null;
    if (claimToken !== undefined && row.claimToken !== claimToken) return null;
    const updated = { ...row, ...changes, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }
}

/** A change feed the test drives by hand with `publish()`. */
export class FakeChangeFeed implements UploadChangeFeed {
  private readonly listeners = new Set<(change: UploadChange) => void>();
  get subscribers() {
    return this.listeners.size;
  }
  subscribe(listener: (change: UploadChange) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(change: UploadChange) {
    this.listeners.forEach((listener) => listener(change));
  }
}

/** Records what the worker asked of the shared rate limiter. Set `refuse` to simulate a full bucket. */
export class FakeRateLimiter implements RateLimiter {
  acquired = 0;
  readonly pauses: number[] = [];
  refuse = false;

  async acquire() {
    if (this.refuse) throw new RateLimitWaitTooLong(60_000);
    this.acquired += 1;
  }
  async pauseFor(ms: number) {
    this.pauses.push(ms);
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

export const HEALTHY: HealthReport = { status: 'ok', checks: { database: { status: 'ok', latencyMs: 1 } } };

/** Canned monitoring data for the /api/ops route: a fresh install with nothing processed yet. */
export const EMPTY_OPS_SNAPSHOT: OpsSnapshot = {
  worker: { lastSeenAt: null, healthy: false },
  queue: { waiting: 0, retrying: 0, processing: 0, oldestWaitingSeconds: null },
  recent: { completed: 0, failed: 0, medianSecondsToResult: null },
  failures: [],
  alerts: { open: [], recent: [] },
};

/** Everything buildApp needs, faked; tests override the parts they care about. */
export function testAppDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    uploads: new InMemoryUploadStore(),
    storage: new InMemoryStorage(),
    changes: new FakeChangeFeed(),
    health: async () => HEALTHY,
    ops: { snapshot: async () => EMPTY_OPS_SNAPSHOT },
    logger: silentLogger,
    ...overrides,
  };
}

