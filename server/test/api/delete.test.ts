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
