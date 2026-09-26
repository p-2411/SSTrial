import { beforeEach, describe, expect, it } from 'vitest';
import type { UploadStatus } from '@label-extractor/shared';
import { deleteUpload, deleteUploads } from '../../src/uploads/delete.ts';
import type { UploadRecord } from '../../src/uploads/store.ts';
import { ADMIN, FILE_BYTES, InMemoryEventStore, InMemoryStorage, InMemoryUploadStore, MEMBER, SAMPLE_EXTRACTION } from '../fakes.ts';

const ID = '4d1e7e7e-0000-4000-8000-000000000001';
const OTHER_MEMBER = { id: '00000000-0000-4000-8000-00000000be02', email: 'other@example.com', role: 'member' as const };

let uploads: InMemoryUploadStore;
let storage: InMemoryStorage;
let events: InMemoryEventStore;

beforeEach(() => {
  uploads = new InMemoryUploadStore();
  storage = new InMemoryStorage();
  events = new InMemoryEventStore();
});

function seed(overrides: Partial<Pick<UploadRecord, 'status' | 'uploadedBy' | 'result' | 'error'>> = {}) {
  const upload = uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION, fileName: 'label.png', uploadedBy: MEMBER.id, ...overrides });
  storage.put(upload.storagePath, FILE_BYTES.png);
  return upload;
}

const remove = (person = MEMBER) => deleteUpload({ uploads, storage, events }, ID, person);

describe('deleteUpload', () => {
  it('deletes the product and its file, and records who deleted what', async () => {
    const upload = seed();

    await expect(remove()).resolves.toMatchObject({ outcome: 'deleted' });
    expect(uploads.rows.has(ID)).toBe(false);
    expect(storage.files.has(upload.storagePath)).toBe(false);
    expect(events.events.at(-1)).toMatchObject({
      type: 'upload.deleted',
      uploadId: ID,
      message: `member@example.com deleted ${SAMPLE_EXTRACTION.productName} (label.png).`,
      // The product's data stays in the log once it's gone.
      data: { fileName: 'label.png', by: 'member@example.com', product: SAMPLE_EXTRACTION },
    });
  });

  it('names just the file for an upload that was never read', async () => {
    seed({ status: 'failed', result: null, error: { code: 'LLM_TIMEOUT' } });

    await remove();

    expect(events.events.at(-1)).toMatchObject({ message: 'member@example.com deleted label.png.' });
    expect(events.events.at(-1)!.data).not.toHaveProperty('product');
  });

  it("lets an admin delete anyone's upload, but not another member", async () => {
    seed();
    await expect(remove(OTHER_MEMBER)).resolves.toEqual({ outcome: 'forbidden' });
    expect(uploads.rows.has(ID)).toBe(true);

    await expect(remove(ADMIN)).resolves.toMatchObject({ outcome: 'deleted' });
  });

  it('leaves uploads from before sign-in to admins', async () => {
    seed({ uploadedBy: null });
    await expect(remove(MEMBER)).resolves.toEqual({ outcome: 'forbidden' });
    await expect(remove(ADMIN)).resolves.toMatchObject({ outcome: 'deleted' });
  });

  it.each<UploadStatus>(['queued', 'processing', 'completed', 'failed'])('can delete an upload that is %s', async (status) => {
    seed({ status, ...(status === 'failed' && { error: { code: 'LLM_TIMEOUT' } }) });
    await expect(remove()).resolves.toMatchObject({ outcome: 'deleted' });
  });

  it("doesn't find one still being uploaded (it isn't listed; its finalise job settles it)", async () => {
    seed({ status: 'uploading' });
    await expect(remove()).resolves.toEqual({ outcome: 'not-found' });
    expect(uploads.rows.has(ID)).toBe(true);
  });

  it('keeps the upload if deleting its file fails, so asking again works', async () => {
    seed();
    storage.unavailable = true;
    await expect(remove()).rejects.toThrow();
    expect(uploads.rows.has(ID)).toBe(true);

    storage.unavailable = false;
    await expect(remove()).resolves.toMatchObject({ outcome: 'deleted' });
  });

  it('reports an upload that no longer exists', async () => {
    await expect(remove()).resolves.toEqual({ outcome: 'not-found' });
    expect(events.events).toEqual([]);
  });

  it("deletes nothing if the deletion can't be recorded: that record is all that's left of the product", async () => {
    seed();
    events.failWrites = true;
    await expect(remove()).rejects.toThrow();
    expect(uploads.rows.has(ID)).toBe(true);

    events.failWrites = false;
    await expect(remove()).resolves.toMatchObject({ outcome: 'deleted' });
    expect(events.types).toEqual(['upload.deleted']);
  });
});

describe('deleteUploads', () => {
  const MINE = '4d1e7e7e-0000-4000-8000-000000000002';
  const THEIRS_IN_REVIEW = '4d1e7e7e-0000-4000-8000-000000000003';
  const UPLOADING = '4d1e7e7e-0000-4000-8000-000000000004';
  const GONE = '4d1e7e7e-0000-4000-8000-000000000099';

  beforeEach(() => {
    for (const [id, overrides] of [
      [ID, { uploadedBy: MEMBER.id }], // a product, but MEMBER's
      [MINE, { uploadedBy: OTHER_MEMBER.id }],
      [THEIRS_IN_REVIEW, { uploadedBy: MEMBER.id, submittedAt: null }],
      [UPLOADING, { uploadedBy: OTHER_MEMBER.id, status: 'uploading', result: null }],
    ] as const) {
      const upload = uploads.seed({ id, status: 'completed', result: SAMPLE_EXTRACTION, ...overrides });
      storage.put(upload.storagePath, FILE_BYTES.png);
    }
  });

  const removeAll = (ids: string[]) => deleteUploads({ uploads, storage, events }, ids, OTHER_MEMBER);

  it('says of each one named whether it was deleted, refused, or not found, removing the files in one request', async () => {
    const report = await removeAll([ID, MINE, THEIRS_IN_REVIEW, UPLOADING, GONE, MINE]);

    expect(report.deleted.map((upload) => upload.id)).toEqual([MINE]);
    expect(report.forbidden).toEqual([ID]);
    // Someone else's upload in Review is as good as not there; one still uploading isn't listed anywhere.
    expect(report.notFound).toEqual([THEIRS_IN_REVIEW, UPLOADING, GONE]);
    expect(storage.removals).toEqual([[`uploads/${MINE}.png`]]);
    expect(events.events.map((event) => [event.type, event.uploadId])).toEqual([['upload.deleted', MINE]]);
  });

  it("touches no row when storage can't be reached, so nothing is reported deleted that isn't", async () => {
    storage.unavailable = true;
    await expect(removeAll([MINE])).rejects.toThrow('Storage is down');
    expect(uploads.rows.has(MINE)).toBe(true);
    expect(events.events).toEqual([]);
  });
});
