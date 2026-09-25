import { pino } from 'pino';
import {
  canTransition,
  LOG_LEVELS,
  UPLOAD_TRANSITIONS,
  type UploadTransition,
  type HealthReport,
  type LabelExtraction,
  type LogEventType,
  type LogLevelFilter,
  type SupportedMimeType,
  type LiveChange,
  type UploadErrorCode,
} from '@label-extractor/shared';
import type { AppDeps } from '../src/api/app.ts';
import { ExtractionError } from '../src/extraction/errors.ts';
import type { RateLimiter } from '../src/extraction/rate-limiter.ts';
import type { ChangeFeed } from '../src/infra/change-feed.ts';
import { StorageUnavailableError, type FileStorage } from '../src/infra/storage.ts';
import type { EventStore, LogEventRecord, NewLogEvent } from '../src/logs/store.ts';
import type { OpsSnapshot } from '../src/ops/store.ts';
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
    const row = this.transition(id, 'confirm', { mimeType });
    if (row) this.enqueued.push(id);
    if (row && options?.cancelFinalise) this.finaliseCancelled.push(id);
    return row;
  }
  async discardUnfinished(id: string, options?: SettleOptions) {
    const row = this.rows.get(id);
    if (!row || !canTransition('discard', row.status)) return null;
    this.rows.delete(id);
    if (options?.cancelFinalise) this.finaliseCancelled.push(id);
    return row;
  }
  async requeue(id: string, from: 'failed' | 'completed') {
    if (this.rows.get(id)?.status !== from) return null;
    const row = this.transition(id, 'rerun', {
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
    return this.transition(id, 'claim', {
      attempts: (row?.attempts ?? 0) + 1,
      error: null,
      claimToken: crypto.randomUUID(),
    });
  }
  async complete(id: string, claimToken: string, result: LabelExtraction) {
    return this.transition(id, 'complete', { result, error: null, completedAt: new Date(), claimToken: null }, claimToken);
  }
  async scheduleRetry(id: string, claimToken: string, code: UploadErrorCode) {
    return this.transition(id, 'retryLater', { error: { code }, claimToken: null }, claimToken);
  }
  async fail(id: string, claimToken: string, code: UploadErrorCode) {
    return this.transition(id, 'fail', { error: { code }, claimToken: null }, claimToken);
  }
  async failAbandoned(id: string, code: UploadErrorCode) {
    return this.transition(id, 'abandon', { error: { code }, claimToken: null });
  }

  /** A lifecycle transition (shared/src/lifecycle.ts) and, when `claimToken` is given, only if it's current. */
  private transition(
    id: string,
    transition: Exclude<UploadTransition, 'discard'>,
    changes: Partial<UploadRecord>,
    claimToken?: string,
  ) {
    const row = this.rows.get(id);
    if (!row || !canTransition(transition, row.status)) return null;
    if (claimToken !== undefined && row.claimToken !== claimToken) return null;
    const updated = { ...row, ...changes, status: UPLOAD_TRANSITIONS[transition].to, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }
}

/** A change feed the test drives by hand with `publish()`. */
export class FakeChangeFeed implements ChangeFeed {
  private readonly listeners = new Set<(change: LiveChange) => void>();
  get subscribers() {
    return this.listeners.size;
  }
  subscribe(listener: (change: LiveChange) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(change: LiveChange) {
    this.listeners.forEach((listener) => listener(change));
  }
}

/** Records what the worker asked of the shared rate limiter. Set `refuse` to simulate a full bucket. */
export class FakeRateLimiter implements RateLimiter {
  acquired = 0;
  readonly pauses: number[] = [];
  refuse = false;

  async acquire() {
    // What the real limiter throws when its bucket stays empty too long: no provider back-off.
    if (this.refuse) throw new ExtractionError('LLM_RATE_LIMITED', 'Shared rate limit: next slot in 60000ms');
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

/** The activity log in memory. Mirrors the real store's filters, ordering and pagination. */
export class InMemoryEventStore implements EventStore {
  readonly events: LogEventRecord[] = [];
  private nextId = 1;

  /** Types recorded so far, oldest first: the usual thing a test asserts on. */
  get types(): LogEventType[] {
    return this.events.map((event) => event.type);
  }

  /** Adds an event as if written at `occurredAt`, for the page and pruning tests. */
  seed(event: NewLogEvent & { occurredAt?: Date; source?: LogEventRecord['source'] }): LogEventRecord {
    const record: LogEventRecord = {
      id: String(this.nextId++),
      occurredAt: event.occurredAt ?? new Date(),
      source: event.source ?? 'api',
      level: event.level,
      type: event.type,
      uploadId: event.uploadId ?? null,
      message: event.message,
      data: event.data ?? {},
    };
    this.events.push(record);
    return record;
  }

  async record(event: NewLogEvent) {
    this.seed(event);
  }

  async list({ level, type, uploadId, limit, after }: { level: LogLevelFilter; type?: LogEventType; uploadId?: string; limit: number; after?: string }) {
    const minimum = level === 'all' ? 0 : LOG_LEVELS.indexOf(level);
    return this.events
      .filter((event) => LOG_LEVELS.indexOf(event.level) >= minimum)
      .filter((event) => !type || event.type === type)
      .filter((event) => !uploadId || event.uploadId === uploadId)
      .filter((event) => !after || Number(event.id) < Number(after))
      .toSorted((a, b) => Number(b.id) - Number(a.id))
      .slice(0, limit);
  }

  async pruneOlderThan(days: number) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const kept = this.events.filter((event) => event.occurredAt.getTime() >= cutoff);
    const pruned = this.events.length - kept.length;
    this.events.splice(0, this.events.length, ...kept);
    return pruned;
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
    events: new InMemoryEventStore(),
    logger: silentLogger,
    ...overrides,
  };
}

