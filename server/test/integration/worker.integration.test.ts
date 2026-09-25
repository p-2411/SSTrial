import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import type { PgBoss } from 'pg-boss';
import { APIConnectionTimeoutError, APIError } from 'openai';
import type { LabelExtractor } from '../../src/extraction/extractor.ts';
import { createDb } from '../../src/infra/db.ts';
import {
  createUploadJobs,
  EXTRACTION_DEAD_LETTER_QUEUE,
  EXTRACTION_QUEUE,
  FINALISE_DELAY_SECONDS,
  FINALISE_QUEUE,
  startQueue,
} from '../../src/infra/queue.ts';
import { createUploadStore, type UploadRecord, type UploadStore } from '../../src/uploads/store.ts';
import { createPostgresRateLimiter } from '../../src/extraction/rate-limiter.ts';
import { startExtractionWorker } from '../../src/worker/worker.ts';
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
const RETRY_LIMIT = 2;
const TEST_SCHEMA = 'pgboss_test'; // isolated from a dev worker that may be running on `pgboss`

type Step = typeof SAMPLE_EXTRACTION | Error | 'hang';

describe.skipIf(!DATABASE_URL)('worker on a real Postgres queue', () => {
  let sql: postgres.Sql;
  let boss: PgBoss;
  let uploads: UploadStore;
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
      return step;
    },
  };

  beforeAll(async () => {
    sql = createDb(DATABASE_URL!, { max: 3 });
    boss = await startQueue({
      connectionString: DATABASE_URL!,
      role: 'worker',
      logger: silentLogger,
      retryPolicy: { retryLimit: RETRY_LIMIT, retryDelay: 1, retryBackoff: false, expireInSeconds: 2 },
      overrides: { schema: TEST_SCHEMA, superviseIntervalSeconds: 1, monitorIntervalSeconds: 1 },
    });
    uploads = createUploadStore(sql, createUploadJobs(boss));
    await startExtractionWorker({
      boss,
      uploads,
      storage,
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
    const upload = await uploads.create({ id, fileName, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${fileName}`, contentSha256: null });
    storage.put(upload.storagePath, uniquePng());
    expect(await uploads.markUploaded(id, 'image/png')).toMatchObject({ status: 'queued' });
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

  const timeout = () => new APIConnectionTimeoutError();

  it('processes a queued upload to completion', async () => {
    const id = await queueUpload(SAMPLE_EXTRACTION);

    const upload = await waitForStatus(id, 'completed');
    expect(upload).toMatchObject({ attempts: 1, result: SAMPLE_EXTRACTION, error: null });
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
      attempts: RETRY_LIMIT + 1,
      error: { code: 'LLM_TIMEOUT' },
    });
    await expect.poll(() => boss.findJobs(EXTRACTION_DEAD_LETTER_QUEUE, { data: { uploadId: id } })).toHaveLength(1);
  }, 30_000);

  it('does not retry a permanent failure', async () => {
    const badKey = APIError.generate(401, { error: { code: 'invalid_api_key', message: 'bad key' } }, undefined, new Headers());
    const id = await queueUpload(badKey);

    const upload = await waitForStatus(id, 'failed');
    expect(upload).toMatchObject({ attempts: 1, error: { code: 'LLM_MISCONFIGURED' } });
    // Wait past the retry delay to prove no second attempt happens.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect((await uploads.findById(id))?.attempts).toBe(1);
  }, 30_000);

  it('streams completed uploads for export', async () => {
    const id = await queueUpload(SAMPLE_EXTRACTION);
    await waitForStatus(id, 'completed');

    const exported: string[] = [];
    for await (const upload of uploads.streamCompleted()) {
      expect(upload.status).toBe('completed');
      exported.push(upload.id);
    }
    expect(exported).toContain(id);
  });

  it('reads results stored before ingredients were structured', async () => {
    const id = crypto.randomUUID();
    createdIds.push(id);
    await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null });
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
    expect(scripts.get(`${id}.png`)!.calls).toBe(RETRY_LIMIT + 1);
  }, 45_000);

  describe('uploads the browser never confirms', () => {
    /** Creates an upload without confirming it — as if the tab closed mid-upload. */
    async function createUnconfirmed(file?: Uint8Array) {
      const id = crypto.randomUUID();
      createdIds.push(id);
      const fileName = `${id}.png`;
      scripts.set(fileName, { steps: [SAMPLE_EXTRACTION], calls: 0 });
      const upload = await uploads.create({ id, fileName, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${fileName}`, contentSha256: null });
      if (file) storage.put(upload.storagePath, file);
      return upload;
    }

    it('schedules a finalise job for after the signed upload URL expires', async () => {
      const upload = await createUnconfirmed();

      const [job] = await boss.findJobs<{ uploadId: string }>(FINALISE_QUEUE, { data: { uploadId: upload.id } });
      const delaySeconds = (job!.startAfter.getTime() - upload.createdAt.getTime()) / 1000;
      expect(delaySeconds).toBeGreaterThanOrEqual(FINALISE_DELAY_SECONDS - 5);
    });

    // The scheduled job runs hours later; these send an immediate one to exercise the handler.
    it('discards the upload when the file never arrived', async () => {
      const upload = await createUnconfirmed();
      await boss.send(FINALISE_QUEUE, { uploadId: upload.id });

      await expect.poll(() => uploads.findById(upload.id), { timeout: 10_000 }).toBeNull();
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
        await uploads.create({ id, fileName: `${id}.png`, mimeType: 'image/png', sizeBytes: 12, storagePath: `integration/${id}.png`, contentSha256: null });
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

    it('counts uploads by status', async () => {
      const counts = await uploads.countByStatus();
      expect(counts.failed).toBeGreaterThanOrEqual(7);
      expect(counts).not.toHaveProperty('uploading');
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
});

