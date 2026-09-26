import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import type { PgBoss } from 'pg-boss';
import {
  canTransition,
  UPLOAD_STATUSES,
  UPLOAD_TRANSITIONS,
  type ExtractionConfidence,
  type UploadStatus,
  type UploadTransition,
} from '@label-extractor/shared';
import { ExtractionError } from '../../src/extraction/errors.ts';
import type { RetryPolicy } from '../../src/extraction/retry-policy.ts';
import type { LabelExtractor } from '../../src/extraction/extractor.ts';
import { listenForChanges } from '../../src/infra/change-feed.ts';
import { createDb } from '../../src/infra/db.ts';
import { startQueue } from '../../src/infra/queue.ts';
import {
  createUploadJobs,
  createUploadQueues,
  EXTRACTION_DEAD_LETTER_QUEUE,
  EXTRACTION_HEARTBEAT_SECONDS,
  EXTRACTION_QUEUE,
  FINALISE_DELAY_SECONDS,
  FINALISE_QUEUE,
} from '../../src/uploads/jobs.ts';
import { createUploadStore, type UploadFilter, type UploadRecord, type UploadStore } from '../../src/uploads/store.ts';
import { createPostgresRateLimiter } from '../../src/extraction/rate-limiter.ts';
import { createEventStore, type EventStore } from '../../src/logs/store.ts';
import { createOpsStore } from '../../src/ops/store.ts';
import { startExtractionWorker, startFinaliseWorker } from '../../src/worker/worker.ts';
import { FILE_BYTES, InMemoryStorage, SAMPLE_EXTRACTION, silentLogger } from '../fakes.ts';

/**
 * Real queue, real database: a pg-boss worker processing jobs from Postgres, exactly as in
 * production, with only storage and the LLM faked. Verifies the retry/back-off/dead-letter wiring
 * that unit tests can only simulate.
 *
 * Needs a Postgres with the migrations applied:  `supabase start`  then  `npm run test:integration`.
 * Skipped when TEST_DATABASE_URL isn't set, so `npm test` works without Docker.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * A valid PNG header plus random bytes. Each test needs its own content: identical files reuse
 * each other's results, which would skip the retry behaviour these tests are about.
 */
const uniquePng = () => new Uint8Array([...FILE_BYTES.png, ...crypto.getRandomValues(new Uint8Array(16))]);

// Fast policy so the whole retry cycle takes seconds: 3 attempts, 1s apart, 2s expiry.
const TEST_POLICY: RetryPolicy = { maxAttempts: 3, firstDelaySeconds: 1, longestDelaySeconds: 1, attemptTimeoutSeconds: 2 };
const TEST_SCHEMA = 'pgboss_test'; // isolated from a dev worker that may be running on `pgboss`

type Step = typeof SAMPLE_EXTRACTION | Error | 'hang';

describe.skipIf(!DATABASE_URL)('worker on a real Postgres queue', () => {
  let sql: postgres.Sql;
  let boss: PgBoss;
  let uploads: UploadStore;
  let events: EventStore;
  const storage = new InMemoryStorage();
  /** Per-file scripts for the fake LLM, keyed by file name. */
  const scripts = new Map<string, { steps: Step[]; calls: number }>();
  const createdIds: string[] = [];
  let releaseHungCalls: () => void = () => {};
  const hung = new Promise<never>((_, reject) => {
    releaseHungCalls = () => reject(new Error('released'));
  });
  hung.catch(() => {});

  const extractor: LabelExtractor = {
    async extract(file) {
      const script = scripts.get(file.fileName)!;
      const step = script.steps[Math.min(script.calls, script.steps.length - 1)]!;
      script.calls += 1;
      if (step === 'hang') return hung; // simulates a worker that hangs/crashes mid-job
      if (step instanceof Error) throw step;
      return { result: step, confidence: null };
    },
  };

  beforeAll(async () => {
    sql = createDb(DATABASE_URL!, { max: 3 });
    boss = await startQueue({
      connectionString: DATABASE_URL!,
      role: 'worker',
      logger: silentLogger,
      overrides: { schema: TEST_SCHEMA, superviseIntervalSeconds: 1, monitorIntervalSeconds: 1 },
    });
    await createUploadQueues(boss, TEST_POLICY);
    uploads = createUploadStore(sql, createUploadJobs(boss));
    events = createEventStore(sql, { source: 'worker', logger: silentLogger });
    await startFinaliseWorker({ boss, uploads, storage, events, logger: silentLogger });
    await startExtractionWorker({
      boss,
      uploads,
      storage,
      events,
      extractor,
      // Real shared limiter, generous enough not to slow these tests down.
      rateLimiter: createPostgresRateLimiter(sql, { key: `test-${crypto.randomUUID()}`, requestsPerMinute: 60_000 }),
      logger: silentLogger,
      concurrency: 4,
      pollingIntervalSeconds: 0.5,
    });
  });

  afterAll(async () => {
    releaseHungCalls();
    await boss?.stop({ graceful: false });
    if (sql) {
      await sql`delete from uploads where id = any(${createdIds})`;
      await sql`delete from events where upload_id = any(${createdIds})`;
      // Tests use their own 'test-…' keys for rate limits; don't leave them in the app's data.
      await sql`delete from llm_rate_limits where key like 'test-%'`;
      await sql.unsafe(`drop schema if exists ${TEST_SCHEMA} cascade`);
      await sql.end();
    }
  });

  /** Creates an upload, "uploads" its file, and confirms it — which enqueues the job for real. */
  async function queueUpload(...steps: Step[]): Promise<string> {
    const id = crypto.randomUUID();
    const fileName = `${id}.png`;
    createdIds.push(id);
    scripts.set(fileName, { steps, calls: 0 });
    const upload = await uploads.create({ id, fileName, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${fileName}`, contentSha256: null, uploadedBy: null });
    storage.put(upload.storagePath, uniquePng());
    expect(await uploads.markUploaded(id, 'image/png', { cancelFinalise: true })).toMatchObject({ status: 'queued' });
    return id;
  }

  async function waitForStatus(id: string, status: UploadRecord['status'], timeoutMs = 20_000): Promise<UploadRecord> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const upload = await uploads.findById(id);
      if (upload?.status === status) return upload;
      if (Date.now() > deadline) throw new Error(`Upload ${id} is ${upload?.status}, expected ${status}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const timeout = () => new ExtractionError('LLM_TIMEOUT');

  /** The activity log for one upload, oldest first. */
  async function eventTypes(uploadId: string) {
    const newestFirst = await events.list({ types: [], uploadId, limit: 100 });
    return newestFirst.map((event) => event.type).reverse();
  }

  it('processes a queued upload to completion', async () => {
    const id = await queueUpload(SAMPLE_EXTRACTION);

    const upload = await waitForStatus(id, 'completed');
    expect(upload).toMatchObject({ attempts: 1, result: SAMPLE_EXTRACTION, error: null });
    await expect.poll(() => eventTypes(id)).toEqual(['extraction.started', 'extraction.completed']);
  });

  it('enqueues exactly one job even if the browser confirms the upload twice', async () => {
    const id = await queueUpload(SAMPLE_EXTRACTION);
    expect(await uploads.markUploaded(id, 'image/png')).toBeNull();

    await waitForStatus(id, 'completed');
    expect(await boss.findJobs(EXTRACTION_QUEUE, { data: { uploadId: id } })).toHaveLength(1);
  });

  it('retries transient failures on the queue and then succeeds', async () => {
    const id = await queueUpload(timeout(), timeout(), SAMPLE_EXTRACTION);

    const upload = await waitForStatus(id, 'completed');
    expect(upload.attempts).toBe(3);
    expect(scripts.get(`${id}.png`)!.calls).toBe(3);
  }, 30_000);

  it('fails the upload after the last retry and dead-letters the job', async () => {
    const id = await queueUpload(timeout());

    const upload = await waitForStatus(id, 'failed');
    expect(upload).toMatchObject({
      attempts: TEST_POLICY.maxAttempts,
      error: { code: 'LLM_TIMEOUT' },
    });
    await expect.poll(() => boss.findJobs(EXTRACTION_DEAD_LETTER_QUEUE, { data: { uploadId: id } })).toHaveLength(1);
    await expect
      .poll(() => eventTypes(id))
      .toEqual([
        ...Array.from({ length: TEST_POLICY.maxAttempts - 1 }, () => ['extraction.started', 'extraction.retry_scheduled']).flat(),
        'extraction.started',
        'extraction.failed',
      ]);
  }, 30_000);

  it('does not retry a permanent failure', async () => {
    const id = await queueUpload(new ExtractionError('LLM_MISCONFIGURED', 'HTTP 401 invalid_api_key'));

    const upload = await waitForStatus(id, 'failed');
    expect(upload).toMatchObject({ attempts: 1, error: { code: 'LLM_MISCONFIGURED' } });
    // Wait past the retry delay to prove no second attempt happens.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect((await uploads.findById(id))?.attempts).toBe(1);
  }, 30_000);

  it('streams products for export: read uploads once they are submitted', async () => {
    const id = await queueUpload(SAMPLE_EXTRACTION);
    await waitForStatus(id, 'completed');
    const exported = async () => {
      const ids: string[] = [];
      for await (const upload of uploads.streamProducts()) {
        expect(upload).toMatchObject({ status: 'completed', submittedAt: expect.any(Date) });
        ids.push(upload.id);
      }
      return ids;
    };
    expect(await exported()).not.toContain(id); // read, but still waiting for review

    await sql`update uploads set submitted_at = now() where id = ${id}`;
    expect(await exported()).toContain(id);
  });

  it('reads results stored before ingredients were structured', async () => {
    const id = crypto.randomUUID();
    createdIds.push(id);
    await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
    const legacy = { ...SAMPLE_EXTRACTION, ingredients: ['Rolled OATS (48%)', 'Salt'] };
    await sql`update uploads set status = 'completed', result = ${sql.json(legacy as postgres.JSONValue)} where id = ${id}`;

    const upload = await uploads.findById(id);
    expect(upload?.result?.ingredients).toEqual([
      { name: 'Rolled OATS (48%)', percent: null, subIngredients: [], allergens: [] },
      { name: 'Salt', percent: null, subIngredients: [], allergens: [] },
    ]);
  });

  it('marks an upload failed via the dead-letter queue when every attempt hangs', async () => {
    const id = await queueUpload('hang');

    // Each attempt expires after 2s and is retried; after the last one pg-boss dead-letters the
    // job and the dead-letter handler fails the upload that would otherwise be stuck "processing".
    const upload = await waitForStatus(id, 'failed', 40_000);
    expect(upload.error?.code).toBe('PROCESSING_TIMEOUT');
    expect(scripts.get(`${id}.png`)!.calls).toBe(TEST_POLICY.maxAttempts);
    await expect.poll(() => eventTypes(id)).toContain('extraction.abandoned');
  }, 45_000);

  describe('uploads the browser never confirms', () => {
    /** Creates an upload without confirming it — as if the tab closed mid-upload. */
    async function createUnconfirmed(file?: Uint8Array) {
      const id = crypto.randomUUID();
      createdIds.push(id);
      const fileName = `${id}.png`;
      scripts.set(fileName, { steps: [SAMPLE_EXTRACTION], calls: 0 });
      const upload = await uploads.create({ id, fileName, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${fileName}`, contentSha256: null, uploadedBy: null });
      if (file) storage.put(upload.storagePath, file);
      return upload;
    }

    it('schedules a finalise job for after the signed upload URL expires', async () => {
      const upload = await createUnconfirmed();

      // The job's ID is the upload's.
      const job = await boss.getJobById(FINALISE_QUEUE, upload.id);
      const delaySeconds = (job!.startAfter.getTime() - upload.createdAt.getTime()) / 1000;
      expect(delaySeconds).toBeGreaterThanOrEqual(FINALISE_DELAY_SECONDS - 5);
    });

    it('cancels the finalise job in the same transaction when the browser confirms', async () => {
      const upload = await createUnconfirmed(uniquePng());
      await uploads.markUploaded(upload.id, 'image/png', { cancelFinalise: true });

      expect((await boss.getJobById(FINALISE_QUEUE, upload.id))?.state).toBe('cancelled');
    });

    it('cancels the finalise job when the browser path discards the upload', async () => {
      const upload = await createUnconfirmed();
      await uploads.discardUnfinished(upload.id, { cancelFinalise: true });

      expect((await boss.getJobById(FINALISE_QUEUE, upload.id))?.state).toBe('cancelled');
    });

    it('keeps the finalise job when confirming without cancelling (the finalise job itself)', async () => {
      const upload = await createUnconfirmed(uniquePng());
      await uploads.markUploaded(upload.id, 'image/png');

      expect((await boss.getJobById(FINALISE_QUEUE, upload.id))?.state).toBe('created');
    });

    // The scheduled job runs hours later; these send an immediate one to exercise the handler.
    it('discards the upload when the file never arrived', async () => {
      const upload = await createUnconfirmed();
      await boss.send(FINALISE_QUEUE, { uploadId: upload.id });

      await expect.poll(() => uploads.findById(upload.id), { timeout: 10_000 }).toBeNull();
      // The upload is gone, but its history isn't: events outlive the row they describe.
      await expect.poll(() => eventTypes(upload.id)).toEqual(['upload.discarded']);
    });

    it('confirms and processes the upload when the file did arrive', async () => {
      const upload = await createUnconfirmed(uniquePng());
      await boss.send(FINALISE_QUEUE, { uploadId: upload.id });

      await expect(waitForStatus(upload.id, 'completed')).resolves.toMatchObject({ result: SAMPLE_EXTRACTION });
    }, 30_000);

    it('deletes the upload and its file when the content is unsupported', async () => {
      const upload = await createUnconfirmed(FILE_BYTES.text);
      await boss.send(FINALISE_QUEUE, { uploadId: upload.id });

      await expect.poll(() => uploads.findById(upload.id), { timeout: 10_000 }).toBeNull();
      expect(storage.files.has(upload.storagePath)).toBe(false);
      await expect.poll(() => eventTypes(upload.id)).toEqual(['upload.rejected']);
    });
  });

  describe('upload list (real SQL)', () => {
    it('pages through uploads with a keyset cursor, without gaps or repeats', async () => {
      // Created in one burst, so several share a millisecond: the ID tie-breaker must keep order exact.
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        const id = crypto.randomUUID();
        createdIds.push(id);
        ids.push(id);
        await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
        await sql`update uploads set status = 'failed', error_code = 'LLM_TIMEOUT' where id = ${id}`;
      }

      const seen: string[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await uploads.list({ statuses: ['failed'], limit: 3, after });
        if (page.length === 0) break;
        seen.push(...page.map((u) => u.id));
        after = page.at(-1)!.id;
      }

      const ours = seen.filter((id) => ids.includes(id));
      expect(new Set(ours).size).toBe(ids.length);
      const all = await uploads.list({ statuses: ['failed'], limit: 1000 });
      expect(ours).toEqual(all.map((u) => u.id).filter((id) => ids.includes(id)));
    });

    it("lists one person's uploads, and counts the ones they have under way", async () => {
      const person = crypto.randomUUID();
      await sql`insert into auth.users (id, email) values (${person}, ${`${person}@example.test`})`;
      try {
        const theirs: string[] = [];
        for (const status of ['uploading', 'queued', 'failed'] as const) {
          const id = crypto.randomUUID();
          createdIds.push(id);
          theirs.push(id);
          await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: person });
          const reason = status === 'failed' ? 'LLM_TIMEOUT' : null; // a failed upload must say why
          await sql`update uploads set status = ${status}, error_code = ${reason} where id = ${id}`;
        }

        const listed = await uploads.list({ statuses: ['queued', 'failed'], uploadedBy: person, limit: 10 });
        expect(listed.map((u) => u.id).sort()).toEqual([theirs[1], theirs[2]].sort());
        expect(await uploads.countUnderWay(person)).toBe(2); // uploading and queued; failed isn't under way
      } finally {
        await sql`delete from uploads where uploaded_by = ${person}`;
        await sql`delete from auth.users where id = ${person}`;
      }
    });
  });

  describe('saved results that no longer match the schema', () => {
    it('are flagged rather than hidden, and can be run again', async () => {
      const id = await queueUpload(SAMPLE_EXTRACTION);
      await waitForStatus(id, 'completed');
      // Simulate a result saved by an older version in a shape this one can't read.
      await sql`update uploads set result = '{"productName": 42}'::jsonb where id = ${id}`;

      const upload = await uploads.findById(id);
      expect(upload).toMatchObject({ status: 'completed', result: null, resultUnreadable: true });

      expect(await uploads.requeue(id, 'completed')).toMatchObject({ status: 'queued', result: null });
      await expect(waitForStatus(id, 'completed')).resolves.toMatchObject({ resultUnreadable: false, result: SAMPLE_EXTRACTION });
    }, 30_000);
  });

  describe('shared rate limiter (real Postgres)', () => {
    const limiter = (options: { requestsPerMinute: number; maxWaitMs?: number; key?: string }) =>
      createPostgresRateLimiter(sql, { key: options.key ?? `test-${crypto.randomUUID()}`, ...options });

    async function timeAcquires(target: ReturnType<typeof limiter>, count: number): Promise<number> {
      const started = Date.now();
      for (let i = 0; i < count; i++) await target.acquire();
      return Date.now() - started;
    }

    it('allows a short burst, then paces requests to the configured rate', async () => {
      // 60/minute = 1 per second, with a burst of 5.
      const limited = limiter({ requestsPerMinute: 60 });
      expect(await timeAcquires(limited, 5)).toBeLessThan(1000);
      expect(await timeAcquires(limited, 2)).toBeGreaterThanOrEqual(1500);
    }, 15_000);

    it('is shared: two workers together get the one budget', async () => {
      const key = `test-${crypto.randomUUID()}`;
      const workerA = limiter({ requestsPerMinute: 60, key });
      const workerB = limiter({ requestsPerMinute: 60, key });
      await timeAcquires(workerA, 5); // uses the whole burst
      expect(await timeAcquires(workerB, 1)).toBeGreaterThanOrEqual(700);
    }, 15_000);

    it('holds every request back while paused', async () => {
      const limited = limiter({ requestsPerMinute: 60_000 });
      await limited.pauseFor(1500);
      expect(await timeAcquires(limited, 1)).toBeGreaterThanOrEqual(1300);
    }, 15_000);

    it('gives up (so the job can back off in the queue) rather than wait longer than allowed', async () => {
      const limited = limiter({ requestsPerMinute: 60_000, maxWaitMs: 500 });
      await limited.pauseFor(5000);
      const started = Date.now();
      await expect(limited.acquire()).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED', retryable: true });
      expect(Date.now() - started).toBeLessThan(1000);
    }, 15_000);
  });

  describe('change notifications (real Postgres triggers)', () => {
    it('announces visible changes, and stays quiet for uploads still being uploaded', async () => {
      const feed = await listenForChanges(sql, silentLogger);
      const seen: string[] = [];
      const id = crypto.randomUUID();
      const unsubscribe = feed.subscribe((change) => {
        if (change.type === 'upload' && change.id === id) seen.push(change.status);
      });

      createdIds.push(id);
      await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
      await uploads.markUploaded(id, 'image/png');

      await expect.poll(() => seen, { timeout: 5000 }).toContain('queued');
      expect(seen[0]).toBe('queued'); // the 'uploading' insert was not announced
      unsubscribe();
    });

    it('announces new activity-log events', async () => {
      const feed = await listenForChanges(sql, silentLogger);
      let announced = 0;
      const unsubscribe = feed.subscribe((change) => {
        if (change.type === 'log') announced += 1;
      });
      const uploadId = crypto.randomUUID();
      createdIds.push(uploadId);

      await events.record({ type: 'extraction.started', uploadId, message: 'x' });

      await expect.poll(() => announced, { timeout: 5000 }).toBeGreaterThan(0);
      unsubscribe();
    });
  });

  describe('activity log (real SQL)', () => {
    /** An upload ID of the test's own, so the assertions ignore events anything else wrote. */
    function testUploadId() {
      const id = crypto.randomUUID();
      createdIds.push(id);
      return id;
    }

    it("lists newest first, at each type's level, filtered by type and upload", async () => {
      const uploadId = testUploadId();
      await events.record({ type: 'extraction.started', uploadId, message: 'one' });
      await events.record({ type: 'extraction.retry_scheduled', uploadId, message: 'two', data: { code: 'LLM_TIMEOUT' } });
      await events.record({ type: 'extraction.failed', uploadId, message: 'three' });
      const messages = async (filters: Partial<Parameters<EventStore['list']>[0]>) =>
        (await events.list({ types: [], uploadId, limit: 10, ...filters })).map((event) => event.message);

      expect(await messages({})).toEqual(['three', 'two', 'one']);
      expect(await messages({ types: ['extraction.failed', 'extraction.retry_scheduled'] })).toEqual(['three', 'two']);
      expect(await messages({ types: ['extraction.retry_scheduled'] })).toEqual(['two']);

      const [latest] = await events.list({ uploadId, types: ['extraction.retry_scheduled'], limit: 1 });
      expect(latest).toMatchObject({ source: 'worker', level: 'warn', uploadId, hasFacts: true });
      expect(latest).not.toHaveProperty('data'); // read only when someone opens it
      expect(latest!.occurredAt).toBeInstanceOf(Date);
      expect(await events.find(latest!.id)).toMatchObject({ message: 'two', data: { code: 'LLM_TIMEOUT' } });
    });

    it('lists what each event needs to say what it has to open, without its data', async () => {
      const uploadId = testUploadId();
      await events.record({ type: 'upload.discarded', uploadId, message: 'just a file', data: { fileName: 'oats.png' } });
      await events.record({ type: 'upload.edited', uploadId, message: 'edited', data: { fileName: 'oats.png', versionId: '42' } });

      expect(await events.list({ types: [], uploadId, limit: 10 })).toMatchObject([
        { message: 'edited', fileName: 'oats.png', versionId: '42', hasFacts: true },
        { message: 'just a file', fileName: 'oats.png', versionId: null, hasFacts: false },
      ]);
    });

    it('finds events between two instants: from inclusive, to exclusive', async () => {
      const uploadId = testUploadId();
      for (const message of ['3 days ago', '2 days ago', '1 day ago']) await events.record({ type: 'extraction.started', uploadId, message });
      await sql`
        update events set occurred_at = date_trunc('day', now()) - (left(message, 1)::int * interval '1 day')
        where upload_id = ${uploadId}`;
      const day = (daysAgo: number) => {
        const date = new Date();
        date.setUTCHours(0, 0, 0, 0);
        return new Date(date.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      };
      const found = async (from?: Date, to?: Date) =>
        (await events.list({ types: [], uploadId, from, to, limit: 10 })).map((event) => event.message);

      expect(await found(day(2))).toEqual(['1 day ago', '2 days ago']);
      expect(await found(undefined, day(2))).toEqual(['3 days ago']);
      expect(await found(day(3), day(1))).toEqual(['2 days ago', '3 days ago']);
    });

    it('finds words anywhere in the message, ignoring case, with % and _ taken literally', async () => {
      const uploadId = testUploadId();
      await events.record({ type: 'extraction.started', uploadId, message: 'Reading Oat_Milk.png.' });
      await events.record({ type: 'extraction.started', uploadId, message: 'Reading oatmilk.png at 100% size.' });
      await events.record({ type: 'extraction.started', uploadId, message: 'Reading C:\\labels\\rice.pdf.' });
      const found = async (search: string) =>
        (await events.list({ types: [], search, uploadId, limit: 10 })).map((event) => event.message);

      expect(await found('OAT')).toEqual(['Reading oatmilk.png at 100% size.', 'Reading Oat_Milk.png.']);
      expect(await found('oat_milk')).toEqual(['Reading Oat_Milk.png.']);
      expect(await found('100%')).toEqual(['Reading oatmilk.png at 100% size.']);
      expect(await found('%')).toEqual(['Reading oatmilk.png at 100% size.']);
      expect(await found('\\rice')).toEqual(['Reading C:\\labels\\rice.pdf.']);
      expect(await found('barley')).toEqual([]);
    });

    it("leaves out rows of a type this version doesn't know, without shortening pages", async () => {
      const uploadId = testUploadId();
      await events.record({ type: 'extraction.started', uploadId, message: 'known' });
      // e.g. an alert event, from before alerts were removed
      await sql`insert into events (source, level, type, upload_id, message) values ('worker', 'warn', 'alert.opened', ${uploadId}, 'gone')`;
      await events.record({ type: 'extraction.completed', uploadId, message: 'also known' });

      const page = await events.list({ types: [], uploadId, limit: 2 });
      expect(page.map((event) => event.message)).toEqual(['also known', 'known']);
    });

    it('pages with a keyset cursor, without gaps or repeats', async () => {
      const uploadId = testUploadId();
      for (let i = 1; i <= 7; i++) await events.record({ type: 'extraction.started', uploadId, message: `${i}` });

      const seen: string[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await events.list({ types: [], uploadId, limit: 3, after });
        if (page.length === 0) break;
        seen.push(...page.map((event) => event.message));
        after = page.at(-1)!.id;
      }
      expect(seen).toEqual(['7', '6', '5', '4', '3', '2', '1']);
    });

    it("keeps a product's history while it exists, and all of it for the retention period once it's deleted", async () => {
      const kept = testUploadId();
      const deletedLongAgo = testUploadId();
      const deletedRecently = testUploadId();
      for (const uploadId of [kept, deletedLongAgo, deletedRecently]) {
        await events.record({ type: 'extraction.started', uploadId, message: 'read long ago' });
      }
      await events.record({ type: 'upload.deleted', uploadId: deletedLongAgo, message: 'deleted long ago' });
      await events.record({ type: 'upload.deleted', uploadId: deletedRecently, message: 'deleted recently' });
      await sql`
        update events set occurred_at = now() - interval '40 days'
        where upload_id in ${sql([kept, deletedLongAgo, deletedRecently])} and message = 'read long ago'`;
      await sql`update events set occurred_at = now() - interval '31 days' where upload_id = ${deletedLongAgo}`;
      const messages = async (uploadId: string) =>
        (await events.list({ types: [], uploadId, limit: 10 })).map((event) => event.message);

      expect(await events.pruneOlderThan(30)).toBeGreaterThanOrEqual(2);

      expect(await messages(kept)).toEqual(['read long ago']);
      expect(await messages(deletedLongAgo)).toEqual([]);
      expect(await messages(deletedRecently)).toEqual(['deleted recently', 'read long ago']);
    });

    it('prunes events about no upload once they pass the retention period', async () => {
      const marker = crypto.randomUUID();
      await events.record({ type: 'process.started', message: `old ${marker}` });
      await events.record({ type: 'process.started', message: `recent ${marker}` });
      await sql`update events set occurred_at = now() - interval '31 days' where message = ${`old ${marker}`}`;

      await events.pruneOlderThan(30);

      const left = await events.list({ types: ['process.started'], search: marker, limit: 10 });
      expect(left.map((event) => event.message)).toEqual([`recent ${marker}`]);
      await sql`delete from events where message like ${`%${marker}`}`;
    });

    it("never rejects when a write fails: it's reported to stdout instead", async () => {
      const logger = { ...silentLogger, warn: vi.fn() } as unknown as typeof silentLogger;
      const store = createEventStore(sql, { source: 'api', logger });
      const uploadId = testUploadId();

      // A message the table's not-null constraint refuses stands in for any failed insert.
      await expect(store.record({ type: 'extraction.started', uploadId, message: null as never })).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'extraction.started' }), 'Could not write to the activity log');
    });
  });

  describe('monitoring store (real SQL)', () => {
    const ops = () => createOpsStore(sql);

    it('reports the worker as healthy right after a heartbeat', async () => {
      const store = ops();
      await store.recordWorkerHeartbeat();
      expect((await store.snapshot()).worker).toMatchObject({ healthy: true, lastSeenAt: expect.any(Date) });
    });

    it('computes the status from real uploads', async () => {
      const snapshot = await ops().snapshot();
      expect(snapshot.queue).toEqual({ waiting: expect.any(Number), retrying: expect.any(Number), processing: expect.any(Number) });
      expect(snapshot.recent.completed).toBeGreaterThan(0); // earlier tests completed uploads
    });
  });

  describe('upload lifecycle guards (real SQL)', () => {
    // Every store write, as the lifecycle transition it performs. Claim-fenced writes get the
    // row's current token, so only the status guard decides.
    const writes: Record<UploadTransition, (id: string, claim: string, status: UploadStatus) => Promise<UploadRecord | null>> = {
      confirm: (id) => uploads.markUploaded(id, 'image/png'),
      discard: (id) => uploads.discardUnfinished(id),
      claim: (id) => uploads.startAttempt(id),
      complete: async (id, claim) => (await uploads.complete(id, claim, SAMPLE_EXTRACTION, null))?.upload ?? null,
      retryLater: (id, claim) => uploads.scheduleRetry(id, claim, 'LLM_TIMEOUT'),
      fail: (id, claim) => uploads.fail(id, claim, 'LLM_REFUSED'),
      abandon: (id) => uploads.failAbandoned(id, 'PROCESSING_TIMEOUT'),
      review: async (id) => (await uploads.saveReview(id, 0, SAMPLE_EXTRACTION, {}))?.upload ?? null,
      delete: (id) => uploads.remove(id),
      // requeue takes the status the caller saw; pass the real one, so only the guard decides.
      rerun: (id, _claim, status) => uploads.requeue(id, status as 'failed' | 'completed'),
    };

    /**
     * An upload in `status` as the app would leave it (a completed one has a result, a failed one a
     * reason), with a claim token, and no job for a running worker to pick up.
     */
    async function uploadIn(status: UploadStatus) {
      const id = crypto.randomUUID();
      createdIds.push(id);
      await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
      const [row] = await sql`
        update uploads
        set status = ${status}, claim_token = gen_random_uuid(),
            result = ${status === 'completed' ? sql.json(SAMPLE_EXTRACTION) : null},
            error_code = ${status === 'failed' ? 'LLM_REFUSED' : null}
        where id = ${id}
        returning claim_token`;
      return { id, claim: row!.claim_token as string };
    }

    const cases = Object.keys(UPLOAD_TRANSITIONS).flatMap((transition) =>
      UPLOAD_STATUSES.map((status) => [transition as UploadTransition, status] as const),
    );

    it.each(cases)('%s from %s happens only if shared/src/lifecycle.ts allows it', async (transition, status) => {
      const { id, claim } = await uploadIn(status);
      const allowed = canTransition(transition, status);

      const written = await writes[transition](id, claim, status);

      if (!allowed) {
        expect(written).toBeNull();
        expect((await uploads.findById(id))?.status).toBe(status);
      } else if (UPLOAD_TRANSITIONS[transition].to === null) {
        expect(await uploads.findById(id)).toBeNull();
      } else {
        // Checked on the returned row: a queued upload may be picked up by the running worker at once.
        expect(written?.status).toBe(UPLOAD_TRANSITIONS[transition].to);
      }
    });
  });

  describe('reviews of extracted data (real SQL)', () => {
    it('saves edits one revision at a time, keeping what the model read', async () => {
      const id = crypto.randomUUID();
      createdIds.push(id);
      await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
      await sql`update uploads set status = 'completed', result = ${sql.json(SAMPLE_EXTRACTION)}, completed_at = now() where id = ${id}`;
      const at = new Date();
      const by = crypto.randomUUID();

      const first = await uploads.saveReview(id, 0, { ...SAMPLE_EXTRACTION, brand: 'First' }, { brand: { kind: 'edited', by, at } });
      expect(first?.upload).toMatchObject({ resultRevision: 1, result: { brand: 'First' }, fieldReviews: { brand: { kind: 'edited', by } } });

      // Made against revision 0 again: someone else saved in between, so nothing is written.
      expect(await uploads.saveReview(id, 0, { ...SAMPLE_EXTRACTION, brand: 'Stale' }, {})).toBeNull();

      await uploads.saveReview(id, 1, { ...SAMPLE_EXTRACTION, brand: 'Second' }, { brand: { kind: 'edited', by, at } });
      const [row] = await sql`select result, original_result, result_revision from uploads where id = ${id}`;
      expect(row).toMatchObject({ result_revision: 2, result: { brand: 'Second' }, original_result: { brand: SAMPLE_EXTRACTION.brand } });
    });
  });

  describe('versions and reverting (real SQL)', () => {
    /** A completed upload, read by "the AI" (with scores), as the worker leaves it. */
    async function readUpload() {
      const id = crypto.randomUUID();
      createdIds.push(id);
      await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
      await sql`update uploads set status = 'queued' where id = ${id}`; // no job, so no worker picks it up
      const claimed = await uploads.startAttempt(id);
      const confidence = Object.fromEntries(
        (['productName', 'brand', 'netWeight', 'allergens', 'ingredients'] as const).map((field) => [field, { score: 90, reasons: [] }]),
      ) as unknown as ExtractionConfidence;
      const read = await uploads.complete(id, claimed!.claimToken!, SAMPLE_EXTRACTION, confidence);
      return { id, reading: read!.versionId };
    }

    it('saves every change as a version, and reverts to one: data, reviews and scores', async () => {
      const { id, reading } = await readUpload();
      const by = crypto.randomUUID();
      const edited = await uploads.saveReview(id, 0, { ...SAMPLE_EXTRACTION, brand: 'Edited' }, { brand: { kind: 'edited', by, at: new Date() } });
      await sql`update uploads set confidence = null where id = ${id}`; // as if a re-run had lost the scores

      expect(await uploads.findVersion(id, reading)).toMatchObject({ id: reading, source: 'extraction' });
      expect(await uploads.findVersion(id, edited!.versionId)).toMatchObject({ source: 'review' });
      expect(await uploads.latestVersionId(id)).toBe(edited!.versionId);

      const reverted = await uploads.revert(id, 1, reading);

      expect(reverted?.upload).toMatchObject({ result: { brand: SAMPLE_EXTRACTION.brand }, fieldReviews: {}, resultRevision: 2 });
      expect(reverted?.upload.confidence?.brand.score).toBe(90);
      expect(await uploads.findVersion(id, reverted!.versionId)).toMatchObject({ source: 'revert' });
      expect(await uploads.latestVersionId(id)).toBe(reverted!.versionId);
    });

    it('reads a version with the one before it, to show what a change did', async () => {
      const { id, reading } = await readUpload();
      const check = { kind: 'checked' as const, by: crypto.randomUUID(), at: new Date() };
      const edited = await uploads.saveReview(id, 0, { ...SAMPLE_EXTRACTION, brand: 'Edited' }, { allergens: check });

      expect(await uploads.readVersion(id, reading)).toEqual({ version: { result: SAMPLE_EXTRACTION, reviewed: [] }, previous: null });
      expect(await uploads.readVersion(id, edited!.versionId)).toEqual({
        version: { result: { ...SAMPLE_EXTRACTION, brand: 'Edited' }, reviewed: ['allergens'] },
        previous: { result: SAMPLE_EXTRACTION, reviewed: [] },
      });
      const other = await readUpload();
      expect(await uploads.readVersion(id, other.reading)).toBeNull(); // not this upload's
    });

    it("won't revert from an older revision, or to another upload's version", async () => {
      const { id, reading } = await readUpload();
      const other = await readUpload();
      await uploads.saveReview(id, 0, { ...SAMPLE_EXTRACTION, brand: 'Edited' }, {});

      expect(await uploads.revert(id, 0, reading)).toBeNull(); // stale revision
      expect(await uploads.revert(id, 1, other.reading)).toBeNull(); // not this upload's
      expect(await uploads.findVersion(id, other.reading)).toBeNull();
      expect((await uploads.findById(id))?.result?.brand).toBe('Edited');
    });
  });

  describe('review and Products (real SQL)', () => {
    it('keeps a read upload out of Products until it is submitted, as the data that was judged ready', async () => {
      const person = crypto.randomUUID();
      await sql`insert into auth.users (id, email) values (${person}, ${`${person}@example.test`})`;
      try {
        const id = crypto.randomUUID();
        createdIds.push(id);
        await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: person });
        await sql`update uploads set status = 'queued' where id = ${id}`; // no job, so no worker picks it up
        const claimed = await uploads.startAttempt(id);
        await uploads.complete(id, claimed!.claimToken!, SAMPLE_EXTRACTION, null);
        const listed = async (submitted: boolean) =>
          (await uploads.list({ statuses: ['completed'], submitted, uploadedBy: person, limit: 10 })).map((u) => u.id);

        expect(await listed(false)).toEqual([id]);
        expect(await listed(true)).toEqual([]);

        expect(await uploads.submit(id, 1, person)).toBeNull(); // not the revision it's at
        const submitted = await uploads.submit(id, 0, person);
        expect(submitted?.submittedAt).toBeInstanceOf(Date);
        expect(await uploads.submit(id, 0, person)).toBeNull(); // already in
        expect(await listed(true)).toEqual([id]);
        expect(await listed(false)).toEqual([]);
        const [row] = await sql`select submitted_by from uploads where id = ${id}`;
        expect(row!.submitted_by).toBe(person);

        // Reading it again takes it back out, to be reviewed again.
        const requeued = await uploads.requeue(id, 'completed');
        expect(requeued).toMatchObject({ status: 'queued', submittedAt: null });
      } finally {
        await sql`delete from uploads where uploaded_by = ${person}`;
        await sql`delete from auth.users where id = ${person}`;
      }
    });

    it('finds products by name, brand or file name, by when they were added, and by ID for an export', async () => {
      const tag = crypto.randomUUID().slice(0, 8); // so other tests' products don't match
      const product = async (fileName: string, productName: string, daysAgo: number) => {
        const id = crypto.randomUUID();
        createdIds.push(id);
        await uploads.create({ id, fileName: `${tag}-${fileName}`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
        const result = { ...SAMPLE_EXTRACTION, productName: `${productName} ${tag}`, brand: 'Brand_50%' };
        await sql`
          update uploads set status = 'completed', result = ${sql.json(result as postgres.JSONValue)},
            submitted_at = now() - make_interval(days => ${daysAgo})
          where id = ${id}`;
        return id;
      };
      const fresh = await product('granola.png', 'Maple Pecan Crunch', 1);
      const older = await product('milk.png', 'Barista Oat Milk', 20);
      const names = async (filter: UploadFilter) =>
        (await uploads.list({ statuses: ['completed'], submitted: true, limit: 100, ...filter }))
          .filter((upload) => upload.fileName.startsWith(tag))
          .map((upload) => upload.fileName.slice(tag.length + 1));

      expect(await names({ search: `oat milk ${tag}`.toUpperCase() })).toEqual(['milk.png']);
      expect(await names({ search: `${tag}-granola` })).toEqual(['granola.png']);
      expect(await names({ search: 'brand_50%' })).toEqual(['milk.png', 'granola.png']); // wildcards taken literally, newest first
      expect(await names({ search: 'brand_5_%' })).toEqual([]);
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      expect(await names({ addedFrom: daysAgo(7) })).toEqual(['granola.png']);
      expect(await names({ addedFrom: daysAgo(30), addedBefore: daysAgo(7) })).toEqual(['milk.png']);

      const exported: string[] = [];
      for await (const upload of uploads.streamProducts({ ids: [older, crypto.randomUUID()] })) exported.push(upload.id);
      expect(exported).toEqual([older]);
      expect(fresh).not.toEqual(older);
    });

    it('only lets a read upload be in Products', async () => {
      const id = crypto.randomUUID();
      createdIds.push(id);
      await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
      await expect(sql`update uploads set submitted_at = now() where id = ${id}`).rejects.toThrow(/uploads_submitted_only_when_completed/);
    });
  });

  describe('claims on uploads being processed (real SQL)', () => {
    async function createProcessable() {
      const id = crypto.randomUUID();
      createdIds.push(id);
      await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null, uploadedBy: null });
      // Straight to 'queued' without a job, so no running worker picks it up during the test.
      await sql`update uploads set status = 'queued' where id = ${id}`;
      return id;
    }

    it('only the attempt holding the current claim can finish the upload', async () => {
      const id = await createProcessable();
      const first = await uploads.startAttempt(id);
      const second = await uploads.startAttempt(id); // e.g. the job was handed to another worker

      expect(first!.claimToken).not.toEqual(second!.claimToken);
      expect(await uploads.complete(id, first!.claimToken!, SAMPLE_EXTRACTION, null)).toBeNull();
      expect(await uploads.scheduleRetry(id, first!.claimToken!, 'LLM_TIMEOUT')).toBeNull();
      expect(await uploads.fail(id, first!.claimToken!, 'LLM_TIMEOUT')).toBeNull();

      await expect(uploads.complete(id, second!.claimToken!, SAMPLE_EXTRACTION, null)).resolves.toMatchObject({
        upload: { status: 'completed', claimToken: null },
      });
    });

    it('the dead-letter safety net can still fail an upload whatever its claim', async () => {
      const id = await createProcessable();
      await uploads.startAttempt(id);
      await expect(uploads.failAbandoned(id, 'PROCESSING_TIMEOUT')).resolves.toMatchObject({ status: 'failed' });
    });

    it('extraction jobs are created with a heartbeat', async () => {
      const id = await queueUpload(SAMPLE_EXTRACTION);
      const [job] = await boss.findJobs(EXTRACTION_QUEUE, { data: { uploadId: id } });
      expect(job!.heartbeatSeconds).toBe(EXTRACTION_HEARTBEAT_SECONDS);
    });
  });
});

