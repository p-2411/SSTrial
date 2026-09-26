import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES, MAX_OPEN_UPLOADS_PER_PERSON } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import {
  ADMIN,
  FILE_BYTES,
  InMemoryEventStore,
  InMemoryStorage,
  InMemoryUploadStore,
  MEMBER,
  SAMPLE_EXTRACTION,
  signedInAs,
  testAppDeps,
} from '../fakes.ts';

// HTTP-level tests: real routing, validation and error handling via Fastify's `inject()`, with
// in-memory fakes in place of Postgres, the queue and Supabase Storage.

let app: App;
let uploads: InMemoryUploadStore;
let storage: InMemoryStorage;
let events: InMemoryEventStore;

beforeEach(async () => {
  uploads = new InMemoryUploadStore();
  storage = new InMemoryStorage();
  events = new InMemoryEventStore();
  app = await buildApp(testAppDeps({ uploads, storage, events }));
});

afterEach(() => app.close());

const ID = '7d0a3f5e-0000-4000-8000-000000000001';

function createUpload(body: object) {
  return app.inject({ method: 'POST', url: '/api/uploads', payload: body });
}

/** Seeds an upload that the browser has "finished uploading", with the given file content. */
function seedUploaded(bytes: Uint8Array, overrides: Parameters<InMemoryUploadStore['seed']>[0] = { id: ID }) {
  const upload = uploads.seed(overrides);
  storage.put(upload.storagePath, bytes);
  return upload;
}

describe('POST /api/uploads — request a signed upload URL', () => {
  it('records who uploaded the file, and names them in the detail', async () => {
    const created = await createUpload({ fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000 });
    const { id } = created.json().upload;

    expect(uploads.get(id).uploadedBy).toBe(ADMIN.id);
    const detail = await app.inject({ method: 'GET', url: `/api/uploads/${id}` });
    expect(detail.json().upload.uploadedBy).toBe(ADMIN.email);
  });

  it('creates an upload and returns a URL to PUT the file to', async () => {
    const response = await createUpload({ fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000 });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.uploadUrl).toMatch(/^https:\/\/storage\.test\/upload\//);
    expect(body.upload).toMatchObject({ fileName: 'label.png', mimeType: 'image/png', status: 'uploading', attempts: 0 });
    // Every upload gets a finalise job, so it can't be left half-done if the browser goes away.
    expect(uploads.finaliseScheduled).toEqual([body.upload.id]);

    const row = uploads.get(body.upload.id);
    // The storage key is generated from the ID, never from the user-supplied file name.
    expect(row.storagePath).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}/${row.id}\\.png$`));
    expect(body.upload).not.toHaveProperty('storagePath');
    expect(events.events).toMatchObject([
      { type: 'upload.created', uploadId: row.id, message: 'admin@example.com started uploading label.png (PNG, 4.9 KB).' },
    ]);
  });

  it.each([
    ['a text file', { fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 100 }],
    ['a GIF', { fileName: 'label.gif', mimeType: 'image/gif', sizeBytes: 100 }],
    ['an iPhone HEIC photo', { fileName: 'IMG_1.HEIC', mimeType: 'image/heic', sizeBytes: 100 }],
    ['a file with no extension or type', { fileName: 'label', mimeType: '', sizeBytes: 100 }],
  ])('rejects %s as an unsupported file type', async (_label, body) => {
    const response = await createUpload(body);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(uploads.rows.size).toBe(0);
    expect(events.types).toEqual([]); // turned away at the door: nothing happened worth keeping
  });

  it('rejects files over the size limit and empty files', async () => {
    const tooBig = await createUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: MAX_FILE_SIZE_BYTES + 1 });
    expect(tooBig.statusCode).toBe(422);
    expect(tooBig.json().error).toMatchObject({ code: 'FILE_TOO_LARGE', message: expect.stringContaining('10 MB') });

    const empty = await createUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 0 });
    expect(empty.json().error.code).toBe('EMPTY_FILE');
  });

  it('rejects a malformed request body', async () => {
    const response = await createUpload({ fileName: 'label.png' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('returns 503 and creates nothing when storage is down', async () => {
    storage.unavailable = true;
    const response = await createUpload({ fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000 });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('STORAGE_UNAVAILABLE');
    expect(uploads.rows.size).toBe(0);
  });
});

describe('POST /api/uploads — duplicate files', () => {
  const HASH = 'a'.repeat(64);
  const request = { fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000, sha256: HASH };

  it('returns the existing upload instead of creating another when the same file was already processed', async () => {
    uploads.seed({ id: ID, status: 'completed', contentSha256: HASH, result: SAMPLE_EXTRACTION });

    const response = await createUpload(request);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ kind: 'duplicate', upload: { id: ID, status: 'completed' } });
    expect(uploads.rows.size).toBe(1);
    expect(uploads.finaliseScheduled).toEqual([]);
    expect(events.events).toMatchObject([{ type: 'upload.duplicate', uploadId: ID }]);
  });

  it("does not point at someone else's upload of the same file while it's still under way (it's theirs alone)", async () => {
    uploads.seed({ id: ID, status: 'processing', contentSha256: HASH, uploadedBy: '00000000-0000-4000-8000-0000000000ff' });
    expect((await createUpload(request)).json().kind).toBe('created');
  });

  it("points at the person's own upload of the same file while it's under way", async () => {
    uploads.seed({ id: ID, status: 'processing', contentSha256: HASH, uploadedBy: ADMIN.id });
    expect((await createUpload(request)).json()).toMatchObject({ kind: 'duplicate', upload: { id: ID } });
  });

  it.each(['failed', 'uploading'] as const)('does not treat a %s upload of the same file as a duplicate', async (status) => {
    uploads.seed({ id: ID, status, contentSha256: HASH, error: status === 'failed' ? { code: 'LLM_TIMEOUT' } : null });

    const response = await createUpload(request);

    expect(response.statusCode).toBe(201);
    expect(response.json().kind).toBe('created');
  });

  it("records the browser's hash on the new upload", async () => {
    const response = await createUpload(request);
    expect(uploads.get(response.json().upload.id).contentSha256).toBe(HASH);
  });

  it('rejects a malformed hash', async () => {
    expect((await createUpload({ ...request, sha256: 'not-a-hash' })).statusCode).toBe(400);
  });
});

describe('POST /api/uploads/:id/complete — confirm the upload and queue it', () => {
  const complete = (id = ID) => app.inject({ method: 'POST', url: `/api/uploads/${id}/complete` });

  it('verifies the file, queues exactly one extraction job and cancels the finalise job', async () => {
    seedUploaded(FILE_BYTES.png);

    const response = await complete();

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({ id: ID, status: 'queued' });
    expect(uploads.enqueued).toEqual([ID]);
    // The upload is settled, so its finalise job would have nothing to do.
    expect(uploads.finaliseCancelled).toEqual([ID]);
  });

  it('is idempotent: confirming twice does not queue the work twice', async () => {
    seedUploaded(FILE_BYTES.png);

    await complete();
    const second = await complete();

    expect(second.statusCode).toBe(200);
    expect(second.json().upload.status).toBe('queued');
    expect(uploads.enqueued).toEqual([ID]);
  });

  it('rejects content that is not really a supported file, and keeps nothing', async () => {
    // e.g. samples/not-really-an-image.jpg: text renamed to .jpg
    const upload = seedUploaded(FILE_BYTES.text, { id: ID, fileName: 'photo.jpg', mimeType: 'image/jpeg' });

    const response = await complete();

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toEqual({
      code: 'FILE_CONTENT_MISMATCH',
      message: 'Unsupported file type. Must be JPEG, PNG, WebP or PDF.',
    });
    // Neither the file nor the upload is stored; the browser shows the reason on its own row.
    expect(storage.files.has(upload.storagePath)).toBe(false);
    expect(uploads.rows.has(ID)).toBe(false);
    expect(uploads.enqueued).toEqual([]);
    expect(uploads.finaliseCancelled).toEqual([ID]);
  });

  it('accepts a valid file with the wrong extension, under its real type', async () => {
    seedUploaded(FILE_BYTES.png, { id: ID, fileName: 'photo.jpg', mimeType: 'image/jpeg' });

    const response = await complete();

    expect(response.json().upload).toMatchObject({ status: 'queued', mimeType: 'image/png' });
  });

  it('returns 409 and leaves the upload pending when the file never arrived', async () => {
    uploads.seed({ id: ID });

    const response = await complete();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('FILE_NOT_UPLOADED');
    expect(uploads.get(ID).status).toBe('uploading');
    expect(uploads.enqueued).toEqual([]);
    // The finalise job stays: it settles the upload if the browser never manages to.
    expect(uploads.finaliseCancelled).toEqual([]);
  });

  it('returns 404 for unknown or malformed IDs', async () => {
    expect((await complete('9b2e7f1a-0000-4000-8000-000000000999')).statusCode).toBe(404);
    expect((await complete('not-a-uuid')).statusCode).toBe(404);
  });
});

describe('GET /api/uploads — the three lists', () => {
  const OTHER_PERSON = '00000000-0000-4000-8000-0000000000ff';
  const list = async (query = '') =>
    (await app.inject({ method: 'GET', url: `/api/uploads${query}` })).json().uploads as Array<{ id: string; status: string }>;

  it("lists everyone's finished products by default, newest first, and nothing still under way", async () => {
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000001', status: 'completed', uploadedBy: OTHER_PERSON, createdAt: new Date('2026-01-01') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000002', status: 'queued', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-02') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000003', status: 'uploading', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-03') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000004', status: 'completed', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-04') });

    expect((await list()).map((u) => u.id)).toEqual(['a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001']);
  });

  it("lists the asker's own uploads under way or failed, and nobody else's", async () => {
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000001', status: 'queued', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-01') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000002', status: 'failed', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-02') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000003', status: 'processing', uploadedBy: OTHER_PERSON, createdAt: new Date('2026-01-03') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000004', status: 'completed', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-04') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000005', status: 'uploading', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-05') });

    expect((await list('?view=upload')).map((u) => u.status)).toEqual(['failed', 'queued']);
  });

  it("lists the asker's own read uploads waiting for review, which aren't in Products yet", async () => {
    const review = { status: 'completed', submittedAt: null, result: SAMPLE_EXTRACTION } as const;
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000001', ...review, uploadedBy: ADMIN.id, createdAt: new Date('2026-01-01') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000002', ...review, uploadedBy: OTHER_PERSON, createdAt: new Date('2026-01-02') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000003', status: 'completed', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-03') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000004', status: 'processing', uploadedBy: ADMIN.id, createdAt: new Date('2026-01-04') });

    const inReview = await list('?view=review');
    expect(inReview.map((u) => u.id)).toEqual(['a0000000-0000-4000-8000-000000000001']);
    expect(inReview[0]).toMatchObject({ submittedAt: null });
    expect((await list()).map((u) => u.id)).toEqual(['a0000000-0000-4000-8000-000000000003']);
  });

  it('searches products by name, brand or file name, and filters them by when they were added', async () => {
    const day = 24 * 60 * 60 * 1000;
    const product = (id: string, fileName: string, productName: string, brand: string, daysAgo: number) =>
      uploads.seed({
        id,
        fileName,
        status: 'completed',
        result: { ...SAMPLE_EXTRACTION, productName, brand },
        submittedAt: new Date(Date.now() - daysAgo * day),
        createdAt: new Date(Date.now() - daysAgo * day),
      });
    product('a0000000-0000-4000-8000-000000000001', 'granola.png', 'Maple Pecan Crunch', 'Harvest & Hearth', 1);
    product('a0000000-0000-4000-8000-000000000002', 'milk.png', 'Barista Oat Milk', 'Oatly', 10);
    product('a0000000-0000-4000-8000-000000000003', 'crackers.pdf', 'Sea Salt Crackers', 'Harvest & Hearth', 40);
    const names = async (query: string) =>
      ((await app.inject({ method: 'GET', url: `/api/uploads${query}` })).json().uploads as Array<{ productName: string }>).map(
        (upload) => upload.productName,
      );

    expect(await names('?q=harvest')).toEqual(['Maple Pecan Crunch', 'Sea Salt Crackers']); // brand
    expect(await names('?q=OAT')).toEqual(['Barista Oat Milk']); // name
    expect(await names('?q=.pdf')).toEqual(['Sea Salt Crackers']); // file name
    const daysAgo = (days: number) => encodeURIComponent(new Date(Date.now() - days * day).toISOString());
    expect(await names(`?from=${daysAgo(7)}`)).toEqual(['Maple Pecan Crunch']);
    expect(await names(`?from=${daysAgo(30)}`)).toEqual(['Maple Pecan Crunch', 'Barista Oat Milk']);
    expect(await names(`?from=${daysAgo(30)}&to=${daysAgo(7)}`)).toEqual(['Barista Oat Milk']); // to is exclusive
    expect(await names(`?q=harvest&from=${daysAgo(30)}`)).toEqual(['Maple Pecan Crunch']);
    expect(await names('?q=%20%20')).toHaveLength(3); // blank words find everything
  });

  it('returns an empty list when there are no uploads', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/uploads' });
    expect(response.json()).toEqual({ uploads: [], nextCursor: null });
  });

  it('rejects an invalid limit, view or cursor', async () => {
    for (const query of ['limit=0', 'limit=500', 'view=everything', 'cursor=not-an-id', 'from=last-week', `q=${'a'.repeat(201)}`]) {
      expect((await app.inject({ method: 'GET', url: `/api/uploads?${query}` })).statusCode).toBe(400);
    }
  });

  it('pages through every upload exactly once, newest first', async () => {
    const ids = seedMany(Array<'completed'>(7).fill('completed'));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/uploads?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await app.inject({ method: 'GET', url })).json();
      seen.push(...page.uploads.map((u: { id: string }) => u.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([...ids].reverse());
  });
});

describe("someone else's unfinished upload is private", () => {
  const OTHER_PERSON = '00000000-0000-4000-8000-0000000000ff';

  it.each(['queued', 'processing', 'failed'] as const)('can’t be opened, nor its history read, when %s', async (status) => {
    uploads.seed({ id: ID, status, uploadedBy: OTHER_PERSON, error: status === 'failed' ? { code: 'LLM_TIMEOUT' } : null });

    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history` })).statusCode).toBe(404);
  });

  it('can’t be retried by anyone else', async () => {
    uploads.seed({ id: ID, status: 'failed', uploadedBy: OTHER_PERSON, error: { code: 'LLM_TIMEOUT' } });
    expect((await app.inject({ method: 'POST', url: `/api/uploads/${ID}/retry` })).statusCode).toBe(404);
    expect(uploads.enqueued).toEqual([]);
  });

  it("is open to its uploader, and once it's finished, to everyone", async () => {
    uploads.seed({ id: ID, status: 'queued', uploadedBy: ADMIN.id });
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).statusCode).toBe(200);

    uploads.seed({ id: ID, status: 'completed', uploadedBy: OTHER_PERSON, result: SAMPLE_EXTRACTION });
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).statusCode).toBe(200);
  });

  it('from before sign-in (no uploader), is left to admins to tidy up', async () => {
    uploads.seed({ id: ID, status: 'failed', uploadedBy: null, error: { code: 'LLM_TIMEOUT' } });
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).statusCode).toBe(200); // signed in as an admin

    await app.close();
    app = await buildApp(testAppDeps({ uploads, storage, events, authenticator: signedInAs(MEMBER) }));
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).statusCode).toBe(404);
  });
});

describe('POST /api/uploads — how many at once', () => {
  it(`refuses a new upload while the person has ${MAX_OPEN_UPLOADS_PER_PERSON} under way`, async () => {
    for (let i = 0; i < MAX_OPEN_UPLOADS_PER_PERSON; i++) {
      uploads.seed({ id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, status: i % 2 ? 'queued' : 'processing', uploadedBy: ADMIN.id });
    }

    const response = await createUpload({ fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000 });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('TOO_MANY_UPLOADS');
    expect(uploads.rows.size).toBe(MAX_OPEN_UPLOADS_PER_PERSON);
  });

  it("doesn't count finished or failed uploads, or other people's", async () => {
    uploads.seed({ id: 'c0000000-0000-4000-8000-000000000001', status: 'completed', uploadedBy: ADMIN.id, result: SAMPLE_EXTRACTION });
    uploads.seed({ id: 'c0000000-0000-4000-8000-000000000002', status: 'failed', uploadedBy: ADMIN.id, error: { code: 'LLM_TIMEOUT' } });
    expect((await createUpload({ fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000 })).statusCode).toBe(201);
  });
});

/** Seeds one upload per status, oldest first; returns their IDs in that order. */
function seedMany(statuses: Array<'completed' | 'failed' | 'queued' | 'processing' | 'uploading'>): string[] {
  return statuses.map((status, i) => {
    const id = `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    uploads.seed({
      id,
      status,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      result: status === 'completed' ? SAMPLE_EXTRACTION : null,
      error: status === 'failed' ? { code: 'LLM_TIMEOUT' } : null,
    });
    return id;
  });
}

describe('GET /api/uploads/:id — detail', () => {
  it('reports how sure the extraction is: every field in the detail, the least certain in the list', async () => {
    const confidence = {
      productName: { score: 97, reasons: [] },
      brand: { score: 95, reasons: [] },
      netWeight: { score: 58, reasons: ['Partly hidden by a fold.'] },
      allergens: { score: 90, reasons: [] },
      ingredients: { score: 88, reasons: [] },
    };
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION, confidence });

    const detail = (await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).json().upload;
    expect(detail.fieldConfidence).toEqual(confidence);
    const [summary] = (await app.inject({ method: 'GET', url: '/api/uploads' })).json().uploads;
    expect(summary.confidence).toBe(58);
  });

  it('checks the scores against the data as it is now, so an edit that contradicts it is flagged', async () => {
    const sure = { score: 95, reasons: [] };
    const confidence = { productName: sure, brand: sure, netWeight: sure, allergens: sure, ingredients: sure };
    // Someone removed the only ingredient containing pecans, but pecans is still declared.
    const result = { ...SAMPLE_EXTRACTION, ingredients: SAMPLE_EXTRACTION.ingredients.filter((i) => i.name !== 'Pecans') };
    uploads.seed({ id: ID, status: 'completed', result, confidence, fieldReviews: {} });

    const detail = (await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).json().upload;
    expect(detail.fieldConfidence.allergens).toEqual({ score: 60, reasons: ['No ingredient contains pecans.'] });
    expect(detail.confidence).toBe(60);
  });

  it('has no scores for uploads extracted before scoring existed', async () => {
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    const detail = (await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).json().upload;
    expect(detail).toMatchObject({ confidence: null, fieldConfidence: null });
  });

  it('returns the extracted data and a preview link for a completed upload', async () => {
    seedUploaded(FILE_BYTES.png, { id: ID, status: 'completed', attempts: 1, result: SAMPLE_EXTRACTION, completedAt: new Date() });

    const response = await app.inject({ method: 'GET', url: `/api/uploads/${ID}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({
      status: 'completed',
      result: SAMPLE_EXTRACTION,
      fileUrl: expect.stringMatching(/^https:\/\/storage\.test\/download\//),
      maxAttempts: 5,
    });
  });

  it('still returns the upload when a preview link cannot be created', async () => {
    seedUploaded(FILE_BYTES.png, { id: ID, status: 'queued' });
    storage.unavailable = true;

    const response = await app.inject({ method: 'GET', url: `/api/uploads/${ID}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({ status: 'queued', fileUrl: null });
  });

  it('returns 404 for an unknown upload', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/uploads/${ID}` });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/uploads/:id/retry — manual retry', () => {
  const retry = () => app.inject({ method: 'POST', url: `/api/uploads/${ID}/retry` });

  it('re-queues a failed upload with a fresh attempt count', async () => {
    seedUploaded(FILE_BYTES.png, {
      id: ID,
      status: 'failed',
      attempts: 5,
      error: { code: 'LLM_TIMEOUT' },
    });

    const response = await retry();

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({ status: 'queued', attempts: 0, error: null });
    expect(uploads.enqueued).toEqual([ID]);
    expect(events.events).toMatchObject([
      { type: 'upload.retry_requested', uploadId: ID, message: 'admin@example.com asked for label.png to be read again.' },
    ]);
  });

  it('refuses to retry a file that is itself the problem', async () => {
    uploads.seed({ id: ID, status: 'failed', error: { code: 'FILE_MISSING' } });

    const response = await retry();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_RETRYABLE');
    expect(uploads.enqueued).toEqual([]);
    expect(events.types).toEqual([]);
  });

  it('refuses to retry an upload that has not failed', async () => {
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    expect((await retry()).statusCode).toBe(409);
  });
});

describe('uploads whose saved result can no longer be read', () => {
  it('says so in the detail and allows running the extraction again', async () => {
    seedUploaded(FILE_BYTES.png, { id: ID, status: 'completed', result: null, resultUnreadable: true, completedAt: new Date() });

    const detail = await app.inject({ method: 'GET', url: `/api/uploads/${ID}` });
    expect(detail.json().upload).toMatchObject({ status: 'completed', result: null, resultUnreadable: true });

    const retried = await app.inject({ method: 'POST', url: `/api/uploads/${ID}/retry` });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().upload).toMatchObject({ status: 'queued', resultUnreadable: false });
    expect(uploads.enqueued).toEqual([ID]);
  });

  it('does not re-run a completed upload whose result reads fine', async () => {
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    expect((await app.inject({ method: 'POST', url: `/api/uploads/${ID}/retry` })).statusCode).toBe(409);
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
});

describe('GET /api/uploads/:id/history', () => {
  const history = (id = ID) => app.inject({ method: 'GET', url: `/api/uploads/${id}/history` });

  it("tells one upload's story, newest first, leaving out other uploads", async () => {
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    events.seed({ type: 'upload.created', uploadId: ID, message: 'uploaded' });
    events.seed({ type: 'extraction.completed', uploadId: 'someone-else', message: 'not this one' });
    events.seed({ type: 'upload.edited', uploadId: ID, message: 'edited' });

    const response = await history();

    expect(response.statusCode).toBe(200);
    expect(response.json().entries.map((entry: { message: string }) => entry.message)).toEqual(['edited', 'uploaded']);
    expect(response.json().nextCursor).toBeNull();
  });

  it('pages, and is searched and filtered like the activity log', async () => {
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    for (let i = 1; i <= 5; i++) events.seed({ type: 'upload.edited', uploadId: ID, message: `edit ${i}` });
    events.seed({ type: 'extraction.failed', uploadId: ID, message: 'failed once', occurredAt: new Date('2026-01-01T00:00:00Z') });
    const messages = async (query: string) =>
      (await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history${query}` })).json().entries.map((entry: { message: string }) => entry.message);

    const first = (await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history?limit=2` })).json();
    expect(first.entries.map((entry: { message: string }) => entry.message)).toEqual(['failed once', 'edit 5']);
    expect(await messages(`?limit=2&cursor=${first.nextCursor}`)).toEqual(['edit 4', 'edit 3']);
    expect(await messages('?q=EDIT%202')).toEqual(['edit 2']);
    expect(await messages('?type=extraction.failed')).toEqual(['failed once']);
    expect(await messages('?to=2026-06-01T00:00:00Z')).toEqual(['failed once']);
  });

  it('shows an entry’s details to anyone who can see the upload, and only its own events’', async () => {
    await app.close();
    app = await buildApp(testAppDeps({ uploads, storage, events, authenticator: signedInAs(MEMBER) }));
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    const edit = events.seed({ type: 'upload.edited', uploadId: ID, message: 'edited', data: { changes: { brand: { from: 'A', to: 'B' } }, checked: [] } });
    const elsewhere = events.seed({ type: 'upload.edited', uploadId: 'someone-else', message: 'edited', data: {} });

    const details = await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history/${edit.id}` });
    expect(details.statusCode).toBe(200);
    expect(details.json()).toEqual({ kind: 'changes', changes: [{ field: 'brand', from: 'A', to: 'B' }], checked: [], unchecked: [] });
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history/${elsewhere.id}` })).statusCode).toBe(404);
  });

  it('is open to members, not just admins', async () => {
    await app.close();
    app = await buildApp(testAppDeps({ uploads, storage, events, authenticator: signedInAs(MEMBER) }));
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    expect((await history()).statusCode).toBe(200);
  });

  it('is a 404 for an upload that doesn’t exist', async () => {
    expect((await history()).statusCode).toBe(404);
  });
});
