import { beforeEach, describe, expect, it } from 'vitest';
import type { UploadStatus } from '@label-extractor/shared';
import { deleteUpload } from '../../src/uploads/delete.ts';
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

function seed(overrides: { status?: UploadStatus; uploadedBy?: string | null } = {}) {
  const upload = uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION, fileName: 'label.png', uploadedBy: MEMBER.id, ...overrides });
  storage.put(upload.storagePath, FILE_BYTES.png);
  return upload;
}

const remove = (person = MEMBER) => deleteUpload({ uploads, storage, events }, ID, person);

describe('deleteUpload', () => {
  it('deletes the file and the upload, and records who deleted it', async () => {
    const upload = seed();

    await expect(remove()).resolves.toMatchObject({ outcome: 'deleted' });
    expect(uploads.rows.has(ID)).toBe(false);
    expect(storage.files.has(upload.storagePath)).toBe(false);
    expect(events.events.at(-1)).toMatchObject({
      type: 'upload.deleted',
      uploadId: ID,
      message: 'member@example.com deleted label.png.',
      data: { fileName: 'label.png', by: 'member@example.com' },
    });
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
});
