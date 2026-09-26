import { afterEach, describe, expect, it } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import { ADMIN, FILE_BYTES, InMemoryEventStore, InMemoryStorage, InMemoryUploadStore, MEMBER, SAMPLE_EXTRACTION, signedInAs, testAppDeps } from '../fakes.ts';

const ID = '5a1e7e7e-0000-4000-8000-000000000001';
const OTHER_MEMBER: CurrentMember = { id: '00000000-0000-4000-8000-00000000be02', email: 'other@example.com', role: 'member' };

let app: App;
afterEach(() => app.close());

/** An app where `person` is signed in, holding one completed upload that MEMBER uploaded. */
async function appFor(person: CurrentMember) {
  const uploads = new InMemoryUploadStore();
  const storage = new InMemoryStorage();
  const events = new InMemoryEventStore();
  const upload = uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION, uploadedBy: MEMBER.id });
  storage.put(upload.storagePath, FILE_BYTES.png);
  app = await buildApp(testAppDeps({ uploads, storage, events, authenticator: signedInAs(person) }));
  return { uploads, storage, events };
}

const del = (id = ID) => app.inject({ method: 'DELETE', url: `/api/uploads/${id}` });
const detail = () => app.inject({ method: 'GET', url: `/api/uploads/${ID}` });

describe('DELETE /api/uploads/:id', () => {
  it('lets the uploader delete it: 204, and it is gone', async () => {
    const { uploads, events } = await appFor(MEMBER);

    const response = await del();

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(uploads.rows.has(ID)).toBe(false);
    expect(events.types).toContain('upload.deleted');
    expect((await detail()).statusCode).toBe(404);
  });

  it("refuses another member (403), and lets an admin", async () => {
    await appFor(OTHER_MEMBER);
    const refused = await del();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toBe('Only the person who uploaded this, or an admin, can delete it.');
    await app.close();

    await appFor(ADMIN);
    expect((await del()).statusCode).toBe(204);
  });

  it('answers 404 for an upload that does not exist, or a malformed ID', async () => {
    await appFor(ADMIN);
    expect((await del('9b2e7f1a-0000-4000-8000-000000000999')).statusCode).toBe(404);
    expect((await del('not-a-uuid')).statusCode).toBe(404);
  });

  it('tells each person whether they may delete it, in the detail', async () => {
    await appFor(MEMBER);
    expect((await detail()).json().upload.canDelete).toBe(true);
    await app.close();

    await appFor(OTHER_MEMBER);
    expect((await detail()).json().upload.canDelete).toBe(false);
  });
});

describe('POST /api/uploads/delete', () => {
  const MINE = '5a1e7e7e-0000-4000-8000-000000000002';
  const deleteMany = (ids: string[]) => app.inject({ method: 'POST', url: '/api/uploads/delete', payload: { ids } });

  it('deletes each one the asker may, and skips the rest', async () => {
    const { uploads, storage, events } = await appFor(OTHER_MEMBER);
    const mine = uploads.seed({ id: MINE, status: 'completed', result: SAMPLE_EXTRACTION, uploadedBy: OTHER_MEMBER.id });
    storage.put(mine.storagePath, FILE_BYTES.png);

    const response = await deleteMany([ID, MINE, '5a1e7e7e-0000-4000-8000-000000000099']);

    expect(response.json()).toEqual({ deleted: [MINE] });
    expect(uploads.rows.has(MINE)).toBe(false);
    expect(storage.files.has(mine.storagePath)).toBe(false);
    expect(uploads.rows.has(ID)).toBe(true); // MEMBER's, so not OTHER_MEMBER's to delete
    expect(events.types).toEqual(['upload.deleted']);
  });

  it("lets an admin delete anyone's", async () => {
    const { uploads } = await appFor(ADMIN);
    expect((await deleteMany([ID])).json()).toEqual({ deleted: [ID] });
    expect(uploads.rows.size).toBe(0);
  });

  it("deletes nothing and says so (503) when storage can't be reached; asking again deletes them all", async () => {
    const { uploads, storage, events } = await appFor(ADMIN);
    const mine = uploads.seed({ id: MINE, status: 'completed', result: SAMPLE_EXTRACTION, uploadedBy: ADMIN.id });
    storage.put(mine.storagePath, FILE_BYTES.png);
    storage.unavailable = true;

    const response = await deleteMany([ID, MINE]);

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('STORAGE_UNAVAILABLE');
    expect([...uploads.rows.keys()].sort()).toEqual([ID, MINE].sort());
    expect(events.events).toEqual([]);

    storage.unavailable = false;
    expect((await deleteMany([ID, MINE])).json()).toEqual({ deleted: [ID, MINE] });
    expect(uploads.rows.size).toBe(0);
    expect(storage.removals).toHaveLength(1); // both files in one request
    expect(events.types).toEqual(['upload.deleted', 'upload.deleted']);
  });

  it('rejects an empty or malformed list', async () => {
    await appFor(ADMIN);
    expect((await deleteMany([])).statusCode).toBe(400);
    expect((await deleteMany(['nope'])).statusCode).toBe(400);
  });
});
