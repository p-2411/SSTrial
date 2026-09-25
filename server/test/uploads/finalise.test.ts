import { beforeEach, describe, expect, it } from 'vitest';
import { finaliseUpload } from '../../src/uploads/finalise.ts';
import { FILE_BYTES, InMemoryStorage, InMemoryUploadStore } from '../fakes.ts';

const ID = '5c0ffee0-0000-4000-8000-000000000001';

let uploads: InMemoryUploadStore;
let storage: InMemoryStorage;

beforeEach(() => {
  uploads = new InMemoryUploadStore();
  storage = new InMemoryStorage();
});

const finalise = (caller: 'browser' | 'finalise-job' = 'browser') => finaliseUpload({ uploads, storage }, ID, { caller });

describe('finaliseUpload', () => {
  it('queues extraction when a supported file has arrived', async () => {
    const upload = uploads.seed({ id: ID });
    storage.put(upload.storagePath, FILE_BYTES.png);

    await expect(finalise()).resolves.toMatchObject({ outcome: 'queued', upload: { status: 'queued' } });
    expect(uploads.enqueued).toEqual([ID]);
  });

  it('accepts a valid file with the wrong extension under its real type', async () => {
    const upload = uploads.seed({ id: ID, fileName: 'photo.jpg', mimeType: 'image/jpeg' });
    storage.put(upload.storagePath, FILE_BYTES.png);

    await expect(finalise()).resolves.toMatchObject({ upload: { mimeType: 'image/png' } });
  });

  it('deletes both the file and the upload when the content is not a supported type', async () => {
    const upload = uploads.seed({ id: ID, fileName: 'photo.jpg', mimeType: 'image/jpeg' });
    storage.put(upload.storagePath, FILE_BYTES.text);

    await expect(finalise()).resolves.toEqual({ outcome: 'rejected' });
    expect(storage.files.has(upload.storagePath)).toBe(false);
    expect(uploads.rows.has(ID)).toBe(false);
    expect(uploads.enqueued).toEqual([]);
  });

  it('keeps the upload if deleting a rejected file fails, so the finalise job can try again', async () => {
    const upload = uploads.seed({ id: ID });
    storage.put(upload.storagePath, FILE_BYTES.text);
    storage.unavailable = true;

    await expect(finalise()).rejects.toThrow();
    expect(uploads.rows.has(ID)).toBe(true);
  });

  it('leaves the upload for the browser when its file has not arrived yet', async () => {
    uploads.seed({ id: ID });

    await expect(finalise('browser')).resolves.toEqual({ outcome: 'not-uploaded' });
    expect(uploads.get(ID).status).toBe('uploading');
  });

  it('discards the upload when the finalise job finds no file (none can arrive any more)', async () => {
    uploads.seed({ id: ID });

    await expect(finalise('finalise-job')).resolves.toEqual({ outcome: 'discarded' });
    expect(uploads.rows.has(ID)).toBe(false);
    expect(uploads.finaliseCancelled).toEqual([]);
  });

  it('is a no-op for an upload that was already finalised (the other caller won)', async () => {
    const upload = uploads.seed({ id: ID, status: 'completed' });
    storage.put(upload.storagePath, FILE_BYTES.png);

    await expect(finalise()).resolves.toMatchObject({ outcome: 'already-finalised' });
    expect(uploads.enqueued).toEqual([]);
  });

  it('cancels the finalise job when the browser confirms the upload', async () => {
    const upload = uploads.seed({ id: ID });
    storage.put(upload.storagePath, FILE_BYTES.png);

    await finalise('browser');
    expect(uploads.finaliseCancelled).toEqual([ID]);
  });

  it('does not cancel the finalise job when it is the one finalising (it would cancel itself)', async () => {
    const upload = uploads.seed({ id: ID });
    storage.put(upload.storagePath, FILE_BYTES.png);

    await expect(finalise('finalise-job')).resolves.toMatchObject({ outcome: 'queued' });
    expect(uploads.finaliseCancelled).toEqual([]);
  });

  it('cancels the finalise job when the browser path rejects the file', async () => {
    const upload = uploads.seed({ id: ID });
    storage.put(upload.storagePath, FILE_BYTES.text);

    await finalise('browser');
    expect(uploads.finaliseCancelled).toEqual([ID]);
  });

  it('reports an upload that no longer exists', async () => {
    await expect(finalise()).resolves.toEqual({ outcome: 'not-found' });
  });
});
