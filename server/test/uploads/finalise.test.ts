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

const finalise = () => finaliseUpload({ uploads, storage }, ID);

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

  it('reports a file that has not arrived without changing anything', async () => {
    uploads.seed({ id: ID });

    await expect(finalise()).resolves.toEqual({ outcome: 'not-uploaded' });
    expect(uploads.get(ID).status).toBe('uploading');
  });

  it('is a no-op for an upload that was already finalised (the other caller won)', async () => {
    const upload = uploads.seed({ id: ID, status: 'completed' });
    storage.put(upload.storagePath, FILE_BYTES.png);

    await expect(finalise()).resolves.toMatchObject({ outcome: 'already-finalised' });
    expect(uploads.enqueued).toEqual([]);
  });

  it('reports an upload that no longer exists', async () => {
    await expect(finalise()).resolves.toEqual({ outcome: 'not-found' });
  });
});
