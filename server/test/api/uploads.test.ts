import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import { FILE_BYTES, InMemoryStorage, InMemoryUploadStore, SAMPLE_EXTRACTION, silentLogger } from '../fakes.ts';

// HTTP-level tests: real routing, validation and error handling via Fastify's `inject()`, with
// in-memory fakes in place of Postgres, the queue and Supabase Storage.

let app: App;
let uploads: InMemoryUploadStore;
let storage: InMemoryStorage;

beforeEach(async () => {
  uploads = new InMemoryUploadStore();
  storage = new InMemoryStorage();
  app = await buildApp({ uploads, storage, logger: silentLogger });
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
  it('creates an upload and returns a URL to PUT the file to', async () => {
    const response = await createUpload({ fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000 });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.uploadUrl).toMatch(/^https:\/\/storage\.test\/upload\//);
    expect(body.upload).toMatchObject({ fileName: 'label.png', mimeType: 'image/png', status: 'uploading', attempts: 0 });

    const row = uploads.get(body.upload.id);
    // The storage key is generated from the ID, never from the user-supplied file name.
    expect(row.storagePath).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}/${row.id}\\.png$`));
    expect(body.upload).not.toHaveProperty('storagePath');
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

describe('POST /api/uploads/:id/complete — confirm the upload and queue it', () => {
  const complete = (id = ID) => app.inject({ method: 'POST', url: `/api/uploads/${id}/complete` });

  it('verifies the file and queues exactly one extraction job', async () => {
    seedUploaded(FILE_BYTES.png);

    const response = await complete();

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({ id: ID, status: 'queued' });
    expect(uploads.enqueued).toEqual([ID]);
  });

  it('is idempotent: confirming twice does not queue the work twice', async () => {
    seedUploaded(FILE_BYTES.png);

    await complete();
    const second = await complete();

    expect(second.statusCode).toBe(200);
    expect(second.json().upload.status).toBe('queued');
    expect(uploads.enqueued).toEqual([ID]);
  });

  it('fails an upload whose content is not really a supported file, without queueing it', async () => {
    // e.g. samples/not-really-an-image.jpg: text renamed to .jpg
    seedUploaded(FILE_BYTES.text, { id: ID, fileName: 'photo.jpg', mimeType: 'image/jpeg' });

    const response = await complete();

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({
      status: 'failed',
      error: { code: 'FILE_CONTENT_MISMATCH', message: expect.stringMatching(/isn't a valid JPEG, PNG, WebP or PDF/) },
    });
    expect(uploads.enqueued).toEqual([]);
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
  });

  it('returns 404 for unknown or malformed IDs', async () => {
    expect((await complete('9b2e7f1a-0000-4000-8000-000000000999')).statusCode).toBe(404);
    expect((await complete('not-a-uuid')).statusCode).toBe(404);
  });
});

describe('GET /api/uploads — list', () => {
  it('lists newest first and hides uploads the browser has not finished', async () => {
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000001', status: 'completed', createdAt: new Date('2026-01-01') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000002', status: 'queued', createdAt: new Date('2026-01-02') });
    uploads.seed({ id: 'a0000000-0000-4000-8000-000000000003', status: 'uploading', createdAt: new Date('2026-01-03') });

    const response = await app.inject({ method: 'GET', url: '/api/uploads' });

    expect(response.statusCode).toBe(200);
    expect(response.json().uploads.map((u: { status: string }) => u.status)).toEqual(['queued', 'completed']);
  });

  it('returns an empty list when there are no uploads', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/uploads' });
    expect(response.json()).toEqual({ uploads: [] });
  });

  it('rejects an invalid limit', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/uploads?limit=0' })).statusCode).toBe(400);
  });
});

describe('GET /api/uploads/:id — detail', () => {
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
      error: { code: 'LLM_TIMEOUT', message: 'The AI service took too long to respond. Gave up after 5 attempts.' },
    });

    const response = await retry();

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({ status: 'queued', attempts: 0, error: null });
    expect(uploads.enqueued).toEqual([ID]);
  });

  it('refuses to retry a file that is itself the problem', async () => {
    uploads.seed({ id: ID, status: 'failed', error: { code: 'FILE_CONTENT_MISMATCH', message: 'Not an image.' } });

    const response = await retry();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_RETRYABLE');
    expect(uploads.enqueued).toEqual([]);
  });

  it('refuses to retry an upload that has not failed', async () => {
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
    expect((await retry()).statusCode).toBe(409);
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
});
