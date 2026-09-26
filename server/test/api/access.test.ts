import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
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

// One rule on every route that names an upload: someone who can't see it (see canViewUpload) is
// told it doesn't exist, whatever they asked to do with it, before any rule about what they may do.

let app: App;
let uploads: InMemoryUploadStore;
let storage: InMemoryStorage;
let events: InMemoryEventStore;

const ID = '6a11ce55-0000-4000-8000-000000000001';

beforeEach(() => {
  uploads = new InMemoryUploadStore();
  storage = new InMemoryStorage();
  events = new InMemoryEventStore();
});
afterEach(() => app.close());

async function signIn(person: CurrentMember) {
  app = await buildApp(testAppDeps({ uploads, storage, events, authenticator: signedInAs(person) }));
}

/** MEMBER's upload, read and waiting in their Review list, with a reading to revert to and some history. */
async function membersUploadInReview() {
  uploads.seed({ id: ID, status: 'processing', claimToken: 'claim', uploadedBy: MEMBER.id });
  const read = await uploads.complete(ID, 'claim', SAMPLE_EXTRACTION, null);
  uploads.seed({ ...uploads.get(ID), submittedAt: null });
  storage.put(uploads.get(ID).storagePath, FILE_BYTES.png);
  const reading = events.seed({ type: 'extraction.completed', uploadId: ID, message: 'read', data: { versionId: read!.versionId } });
  return { versionId: read!.versionId, eventId: reading.id };
}

describe("someone else's upload that isn't in Products", () => {
  it.each([
    ['an admin', ADMIN],
    ['another member', { id: '00000000-0000-4000-8000-00000000be02', email: 'other@example.com', role: 'member' as const }],
  ])('is a 404 to %s on every route that names it, and nothing changes', async (_label, person) => {
    const { versionId, eventId } = await membersUploadInReview();
    await signIn(person);
    const before = structuredClone(uploads.get(ID));
    const eventsBefore = events.events.length;

    const requests = [
      { method: 'GET', url: `/api/uploads/${ID}` },
      { method: 'POST', url: `/api/uploads/${ID}/complete` },
      { method: 'PATCH', url: `/api/uploads/${ID}/result`, payload: { revision: 0, checked: ['brand'] } },
      { method: 'POST', url: `/api/uploads/${ID}/retry` },
      { method: 'POST', url: `/api/uploads/${ID}/revert`, payload: { revision: 0, versionId } },
      { method: 'GET', url: `/api/uploads/${ID}/history` },
      { method: 'GET', url: `/api/uploads/${ID}/history/${eventId}` },
      { method: 'DELETE', url: `/api/uploads/${ID}` },
    ] as const;
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(404);
      expect(response.json().error).toEqual({ code: 'NOT_FOUND', message: 'Upload not found.' });
    }

    expect(uploads.get(ID)).toEqual(before);
    expect(storage.files.has(before.storagePath)).toBe(true);
    expect(events.events).toHaveLength(eventsBefore);
  });

  it('is skipped by every action on several at once, and left out of exports', async () => {
    await membersUploadInReview();
    await signIn(ADMIN);
    const bulk = (path: string) => app.inject({ method: 'POST', url: `/api/uploads/${path}`, payload: { ids: [ID] } });

    expect((await bulk('delete')).json()).toEqual({ deleted: [] });
    expect((await bulk('check')).json()).toEqual({ checked: [] });
    expect((await bulk('submit')).json()).toEqual({ submitted: [] });
    const exported = await app.inject({ method: 'GET', url: `/api/exports/uploads.json?id=${ID}` });
    expect(exported.json().uploads).toEqual([]);
    expect(uploads.rows.has(ID)).toBe(true);
  });

  it('is open to its uploader on every route', async () => {
    const { eventId } = await membersUploadInReview();
    await signIn(MEMBER);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history/${eventId}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/uploads/${ID}` })).statusCode).toBe(204);
  });
});

describe('what may be done with a product, which everyone can see', () => {
  beforeEach(() => {
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION, uploadedBy: ADMIN.id });
  });

  it("refuses a member who didn't upload it (403) deleting it or putting its data back", async () => {
    await signIn(MEMBER);
    expect((await app.inject({ method: 'DELETE', url: `/api/uploads/${ID}` })).statusCode).toBe(403);
    const revert = await app.inject({ method: 'POST', url: `/api/uploads/${ID}/revert`, payload: { revision: 0, versionId: '1' } });
    expect(revert.statusCode).toBe(403);
    expect(revert.json().error.code).toBe('FORBIDDEN');
  });

  it('opens only the history entries the history offers to open, not every event’s facts', async () => {
    const failure = events.seed({ type: 'extraction.failed', uploadId: ID, message: 'failed', data: { code: 'LLM_TIMEOUT', attempt: 1 } });
    const edit = events.seed({ type: 'upload.edited', uploadId: ID, message: 'edited', data: { changes: {}, checked: ['brand'] } });
    await signIn(MEMBER);

    const hidden = await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history/${failure.id}` });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error.message).toBe('Event not found.');
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${ID}/history/${edit.id}` })).statusCode).toBe(200);
  });
});

describe('reading a completed upload again', () => {
  /** A product whose saved result can no longer be read, so it may be read again. */
  const unreadable = (uploadedBy: string | null) =>
    uploads.seed({ id: ID, status: 'completed', result: null, resultUnreadable: true, uploadedBy });
  const retry = () => app.inject({ method: 'POST', url: `/api/uploads/${ID}/retry` });

  it("is refused (403) to a member who can see the product but didn't upload it: it would take it out of Products", async () => {
    unreadable(ADMIN.id);
    await signIn(MEMBER);

    const response = await retry();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    expect(uploads.get(ID).status).toBe('completed');
    expect(uploads.enqueued).toEqual([]);
  });

  it('tells each person, in the detail, whether they may ask for it', async () => {
    const canRetry = async () => (await app.inject({ method: 'GET', url: `/api/uploads/${ID}` })).json().upload.canRetry;
    unreadable(ADMIN.id);
    await signIn(MEMBER);
    expect(await canRetry()).toBe(false);
    await app.close();

    unreadable(MEMBER.id);
    await signIn(MEMBER);
    expect(await canRetry()).toBe(true);
  });

  it('is open to its uploader, and to admins', async () => {
    unreadable(MEMBER.id);
    await signIn(MEMBER);
    expect((await retry()).statusCode).toBe(200);
    await app.close();

    unreadable(MEMBER.id);
    await signIn(ADMIN);
    expect((await retry()).statusCode).toBe(200);
    expect(uploads.get(ID).uploadedBy).toBe(MEMBER.id); // still theirs to review
  });

  it("makes an upload from before sign-in the asker's, so the new reading is listed for them and can be submitted", async () => {
    unreadable(null);
    await signIn(ADMIN);

    expect((await retry()).statusCode).toBe(200);

    expect(uploads.get(ID)).toMatchObject({ status: 'queued', uploadedBy: ADMIN.id, submittedAt: null });
    const listed = (await app.inject({ method: 'GET', url: '/api/uploads?view=upload' })).json().uploads;
    expect(listed.map((upload: { id: string }) => upload.id)).toEqual([ID]);

    // Read again (every field confident), it waits in their Review list, and they can submit it.
    await uploads.startAttempt(ID);
    const sure = { score: 95, reasons: [] };
    await uploads.complete(ID, uploads.get(ID).claimToken!, SAMPLE_EXTRACTION, {
      productName: sure,
      brand: sure,
      netWeight: sure,
      allergens: sure,
      ingredients: sure,
    });
    const submitted = await app.inject({ method: 'POST', url: '/api/uploads/submit', payload: { ids: [ID] } });
    expect(submitted.json()).toEqual({ submitted: [ID] });
  });
});
