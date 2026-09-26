import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/api/app.ts';
import { ADMIN, InMemoryEventStore, InMemoryUploadStore, MEMBER, SAMPLE_EXTRACTION, signedInAs, testAppDeps } from '../fakes.ts';

let app: App;
let uploads: InMemoryUploadStore;
let events: InMemoryEventStore;

const ID = '5d9e2f3a-0000-4000-8000-000000000001';

/** The original reading, saved as version 1 as the worker does when an upload completes, then submitted to Products. */
async function readByTheAi() {
  uploads.seed({ id: ID, status: 'processing', claimToken: 'claim' });
  await uploads.complete(ID, 'claim', SAMPLE_EXTRACTION, null);
  await uploads.submit([{ id: ID, revision: 0 }], ADMIN.id);
}

beforeEach(async () => {
  uploads = new InMemoryUploadStore();
  events = new InMemoryEventStore();
  app = await buildApp(testAppDeps({ uploads, events }));
  await readByTheAi();
});
afterEach(() => app.close());

const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/uploads/${ID}/result`, payload });
const revert = (payload: object) => app.inject({ method: 'POST', url: `/api/uploads/${ID}/revert`, payload });

describe('POST /api/uploads/:id/revert', () => {
  it('puts the data back as it was, undoing later edits and checks, and records it', async () => {
    await patch({ revision: 0, changes: { brand: 'Edited Brand' }, checked: ['allergens'] });

    const response = await revert({ revision: 1, versionId: '1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({ result: { brand: SAMPLE_EXTRACTION.brand }, fieldReviews: {}, revision: 2 });
    expect(events.events.at(-1)).toMatchObject({
      type: 'upload.reverted',
      message: `${ADMIN.email} put label.png back to the original reading.`,
      data: { revertedTo: '1', versionId: '3' },
    });
    // Nothing is erased: the revert is a version of its own, so it can be undone too.
    expect(uploads.versions.map((version) => version.source)).toEqual(['extraction', 'review', 'revert']);
  });

  it("is for admins only", async () => {
    await app.close();
    app = await buildApp(testAppDeps({ uploads, events, authenticator: signedInAs(MEMBER) }));
    expect((await revert({ revision: 0, versionId: '1' })).statusCode).toBe(403);
  });

  it("refuses a revert made against an older revision, so it can't undo a change the admin hasn't seen", async () => {
    await patch({ revision: 0, changes: { brand: 'Edited Brand' } });

    const response = await revert({ revision: 0, versionId: '1' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EDIT_CONFLICT');
    expect(uploads.get(ID).result?.brand).toBe('Edited Brand');
  });

  it("is a 404 for a version that isn't this upload's", async () => {
    uploads.seed({ id: 'other', status: 'processing', claimToken: 'c' });
    await uploads.complete('other', 'c', SAMPLE_EXTRACTION, null); // version 2, the other upload's

    expect((await revert({ revision: 0, versionId: '2' })).statusCode).toBe(404);
    expect((await revert({ revision: 0, versionId: '999' })).statusCode).toBe(404);
  });

  it("refuses an upload that isn't completed", async () => {
    uploads.seed({ id: ID, status: 'queued' });
    expect((await revert({ revision: 0, versionId: '1' })).json().error.code).toBe('NOT_EDITABLE');
  });

  it("tells the detail who may revert: admins, once it's completed", async () => {
    const canRevert = async () => (await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).json().upload.canRevert;
    expect(await canRevert()).toBe(true);

    await app.close();
    app = await buildApp(testAppDeps({ uploads, events, authenticator: signedInAs(MEMBER) }));
    expect(await canRevert()).toBe(false);
  });

  it('rejects a malformed request', async () => {
    expect((await revert({ revision: 0, versionId: 'latest' })).statusCode).toBe(400);
  });
});
