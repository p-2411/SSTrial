import { pino } from 'pino';
import {
  canTransition,
  LOG_EVENT_TYPES,
  UPLOAD_TRANSITIONS,
  type UploadTransitionKeepingRow,
  type HealthReport,
  type LabelExtraction,
  type LogEventType,
  type SupportedMimeType,
  type LiveChange,
  type UploadErrorCode,
  type CurrentMember,
  type ExtractionConfidence,
  type PublicConfig,
} from '@label-extractor/shared';
import type { AppDeps } from '../src/api/app.ts';
import type { Authenticator } from '../src/auth/authenticator.ts';
import { ExtractionError } from '../src/extraction/errors.ts';
import type { RateLimiter } from '../src/extraction/rate-limiter.ts';
import type { ChangeFeed } from '../src/infra/change-feed.ts';
import { StorageUnavailableError, type FileStorage } from '../src/infra/storage.ts';
import type { EventStore, LogEventRecord, NewLogEvent } from '../src/logs/store.ts';
import type { OpsSnapshot } from '../src/ops/store.ts';
import type {
  NewUpload,
  SettleOptions,
  StoredFieldReviews,
  UploadRecord,
  UploadStore,
  UploadVersion,
  Versioned,
} from '../src/uploads/store.ts';

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
  /** Saved states of each upload's data, as the upload_versions table keeps them. */
  readonly versions: Array<UploadVersion & { uploadId: string; state: Pick<UploadRecord, 'result' | 'confidence' | 'fieldReviews'> }> = [];
  private nextVersionId = 1;

  /** Saves the upload's current data as a version, as the real store does with every change. */
  private saveVersion(upload: UploadRecord, source: UploadVersion['source']): Versioned {
    const version = {
      id: String(this.nextVersionId++),
      source,
      createdAt: new Date(),
      uploadId: upload.id,
      state: { result: upload.result, confidence: upload.confidence, fieldReviews: upload.fieldReviews },
    };
    this.versions.push(version);
    return { upload, versionId: version.id };
  }

  seed(overrides: Partial<UploadRecord> & { id: string }): UploadRecord {
    const now = new Date();
    const record: UploadRecord = {
      fileName: 'label.png',
      mimeType: 'image/png',
      sizeBytes: 1234,
      storagePath: `uploads/${overrides.id}.png`,
      contentSha256: null,
      uploadedBy: null,
      originalResult: null,
      confidence: null,
      fieldReviews: {},
      resultRevision: 0,
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
  async list({
    statuses,
    uploadedBy,
    limit,
    after,
  }: {
    statuses: readonly UploadRecord['status'][];
    uploadedBy?: string;
    limit: number;
    after?: string;
  }) {
    const newestFirst = [...this.rows.values()]
      .filter((row) => statuses.includes(row.status) && (!uploadedBy || row.uploadedBy === uploadedBy))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const start = after ? newestFirst.findIndex((row) => row.id === after) + 1 : 0;
    return newestFirst.slice(start, start + limit);
  }
  async countUnderWay(uploadedBy: string) {
    const underWay: readonly UploadRecord['status'][] = ['uploading', 'queued', 'processing'];
    return [...this.rows.values()].filter((row) => row.uploadedBy === uploadedBy && underWay.includes(row.status)).length;
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
  async remove(id: string) {
    const row = this.rows.get(id);
    if (!row || !canTransition('delete', row.status)) return null;
    this.rows.delete(id);
    this.finaliseCancelled.push(id);
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
    const current = this.rows.get(id);
    if (current?.status !== from) return null;
    const row = this.transition(id, 'rerun', {
      attempts: 0,
      error: null,
      result: null,
      resultUnreadable: false,
      originalResult: null,
      confidence: null,
      fieldReviews: {},
      resultRevision: current.resultRevision + 1,
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
  async saveReview(id: string, revision: number, result: LabelExtraction, fieldReviews: StoredFieldReviews) {
    const row = this.rows.get(id);
    if (!row || !canTransition('review', row.status) || row.resultRevision !== revision) return null;
    const saved = {
      ...row,
      originalResult: row.originalResult ?? row.result,
      result,
      fieldReviews,
      resultRevision: revision + 1,
      updatedAt: new Date(),
    };
    this.rows.set(id, saved);
    return this.saveVersion(saved, 'review');
  }
  async revert(id: string, revision: number, versionId: string) {
    const row = this.rows.get(id);
    const version = this.versions.find((v) => v.id === versionId && v.uploadId === id);
    if (!row || !version || !canTransition('review', row.status) || row.resultRevision !== revision) return null;
    const reverted = {
      ...row,
      ...version.state,
      originalResult: row.originalResult ?? row.result,
      resultRevision: revision + 1,
      updatedAt: new Date(),
    };
    this.rows.set(id, reverted);
    return this.saveVersion(reverted, 'revert');
  }
  async listVersions(id: string) {
    return this.versions.filter((v) => v.uploadId === id).map(({ id: versionId, source, createdAt }) => ({ id: versionId, source, createdAt }));
  }
  async complete(id: string, claimToken: string, result: LabelExtraction, confidence: ExtractionConfidence | null) {
    const done = await this.transition(id, 'complete', { result, confidence, error: null, completedAt: new Date(), claimToken: null }, claimToken);
    return done && this.saveVersion(done, 'extraction');
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
    transition: UploadTransitionKeepingRow,
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
      level: LOG_EVENT_TYPES[event.type].level,
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

  async list({ types, uploadId, limit, after }: { types: LogEventType[]; uploadId?: string; limit: number; after?: string }) {
    return this.events
      .filter((event) => types.length === 0 || types.includes(event.type))
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

export const ADMIN: CurrentMember = { id: '00000000-0000-4000-8000-00000000ad01', email: 'admin@example.com', role: 'admin' };
export const MEMBER: CurrentMember = { id: '00000000-0000-4000-8000-00000000be01', email: 'member@example.com', role: 'member' };
export const TEST_PUBLIC_CONFIG: PublicConfig = { supabaseUrl: 'http://supabase.test', supabasePublishableKey: 'sb_publishable_test' };

/** Every request is from this member. */
export function signedInAs(member: CurrentMember): Authenticator {
  return { authenticate: async () => ({ outcome: 'signed-in', member, expiresAt: null }) };
}

export const HEALTHY: HealthReport = { status: 'ok', checks: { database: { status: 'ok', latencyMs: 1 } } };

/** Canned monitoring data for the /api/ops route: a fresh install with nothing processed yet. */
export const EMPTY_OPS_SNAPSHOT: OpsSnapshot = {
  worker: { lastSeenAt: null, healthy: false },
  queue: { waiting: 0, retrying: 0, processing: 0 },
  recent: { completed: 0, failed: 0, medianSecondsToResult: null },
  failures: [],
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
    // Every request is the admin, so tests about other things don't have to sign in.
    authenticator: signedInAs(ADMIN),
    members: {
      emailsOf: async (ids: readonly string[]) =>
        new Map([ADMIN, MEMBER].filter((member) => ids.includes(member.id)).map((member) => [member.id, member.email])),
    },
    publicConfig: TEST_PUBLIC_CONFIG,
    ...overrides,
  };
}

