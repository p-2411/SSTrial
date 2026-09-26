import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_EVENTS_PATH, logEventDetailsPath, type ListLogsResponse } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import { InMemoryEventStore, InMemoryUploadStore, MEMBER, SAMPLE_EXTRACTION, signedInAs, testAppDeps } from '../fakes.ts';

let app: App;
let events: InMemoryEventStore;

beforeEach(async () => {
  events = new InMemoryEventStore();
  app = await buildApp(testAppDeps({ events }));
  return () => app.close();
});

const UPLOAD = '9e1b7c2a-0000-4000-8000-000000000001';
const OTHER_UPLOAD = '9e1b7c2a-0000-4000-8000-000000000002';

async function getLogs(query = ''): Promise<ListLogsResponse> {
  const response = await app.inject({ method: 'GET', url: `${LOG_EVENTS_PATH}${query}` });
  expect(response.statusCode).toBe(200);
  return response.json();
}

const messages = (body: ListLogsResponse) => body.events.map((event) => event.message);

describe('GET /api/logs', () => {
  it('returns events newest first, with ISO timestamps', async () => {
    const occurredAt = new Date('2026-09-25T08:00:00Z');
    events.seed({ type: 'process.started', message: 'API started.', occurredAt });
    events.seed({ type: 'upload.created', uploadId: UPLOAD, message: 'label.png started uploading.', data: { fileName: 'label.png' } });

    const body = await getLogs();

    expect(messages(body)).toEqual(['label.png started uploading.', 'API started.']);
    // Without its data, which is fetched only when someone opens its details.
    expect(body.events[0]).toEqual({
      id: '2',
      occurredAt: expect.any(String),
      source: 'api',
      level: 'info',
      type: 'upload.created',
      uploadId: UPLOAD,
      message: 'label.png started uploading.',
      fileName: 'label.png',
      hasDetails: false, // nothing to say beyond the file name
    });
    expect(body.events[1]!.occurredAt).toBe('2026-09-25T08:00:00.000Z');
    expect(body.nextCursor).toBeNull();
  });

  it('filters by any number of types, and by upload', async () => {
    events.seed({ type: 'extraction.started', uploadId: UPLOAD, message: 'started' });
    events.seed({ type: 'extraction.retry_scheduled', uploadId: UPLOAD, message: 'retrying' });
    events.seed({ type: 'extraction.failed', uploadId: UPLOAD, message: 'failed' });
    events.seed({ type: 'extraction.abandoned', uploadId: OTHER_UPLOAD, message: 'abandoned' });

    expect(messages(await getLogs('?type=extraction.started'))).toEqual(['started']);
    expect(messages(await getLogs('?type=extraction.failed&type=extraction.abandoned'))).toEqual(['abandoned', 'failed']);
    expect(messages(await getLogs(`?upload=${UPLOAD}&type=extraction.failed&type=extraction.abandoned`))).toEqual(['failed']);
    expect(messages(await getLogs(`?upload=${UPLOAD}`))).toEqual(['failed', 'retrying', 'started']);
  });

  it('finds events by words in their message, with the other filters', async () => {
    events.seed({ type: 'upload.created', uploadId: UPLOAD, message: 'ana@example.com started uploading Oat Milk.png.' });
    events.seed({ type: 'extraction.failed', uploadId: UPLOAD, message: "Couldn't read Oat Milk.png." });
    events.seed({ type: 'upload.created', uploadId: OTHER_UPLOAD, message: 'ana@example.com started uploading rice.pdf.' });

    expect(messages(await getLogs('?q=oat%20milk'))).toEqual(["Couldn't read Oat Milk.png.", 'ana@example.com started uploading Oat Milk.png.']);
    expect(messages(await getLogs('?q=ana@example.com&type=upload.created&upload=' + OTHER_UPLOAD))).toEqual([
      'ana@example.com started uploading rice.pdf.',
    ]);
    // Blank words find everything, rather than nothing.
    expect(messages(await getLogs('?q=%20%20'))).toHaveLength(3);
  });

  it("records each event at its type's level", async () => {
    events.seed({ type: 'extraction.failed', message: 'failed' });
    events.seed({ type: 'extraction.retry_scheduled', message: 'retrying' });
    events.seed({ type: 'extraction.completed', message: 'done' });

    expect((await getLogs()).events.map((event) => event.level)).toEqual(['info', 'warn', 'error']);
  });

  it('pages through every event exactly once', async () => {
    for (let i = 1; i <= 5; i++) events.seed({ type: 'extraction.started', message: `${i}` });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const body: ListLogsResponse = await getLogs(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...messages(body));
      cursor = body.nextCursor;
    } while (cursor);

    expect(seen).toEqual(['5', '4', '3', '2', '1']);
  });

  it('finds events between two instants, from inclusive and to exclusive', async () => {
    for (const day of ['24', '25', '26']) {
      events.seed({ type: 'extraction.started', message: day, occurredAt: new Date(`2026-09-${day}T00:00:00Z`) });
    }

    expect(messages(await getLogs('?from=2026-09-25T00:00:00Z'))).toEqual(['26', '25']);
    expect(messages(await getLogs('?to=2026-09-25T00:00:00Z'))).toEqual(['24']);
    // The browser sends its own midnights, with its offset.
    expect(messages(await getLogs(`?from=${encodeURIComponent('2026-09-25T10:00:00+10:00')}&to=2026-09-26T00:00:00Z`))).toEqual(['25']);
  });

  it.each([
    ['an unknown type', '?type=upload.exploded'],
    ['a malformed upload ID', '?upload=not-a-uuid'],
    ['a malformed cursor', '?cursor=abc'],
    ['a limit over 200', '?limit=201'],
    ['a search over 200 characters', `?q=${'a'.repeat(201)}`],
    ['a date that is not a date-time', '?from=yesterday'],
  ])('rejects %s', async (_label, query) => {
    const response = await app.inject({ method: 'GET', url: `${LOG_EVENTS_PATH}${query}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('says which events have details to open', async () => {
    events.seed({ type: 'extraction.failed', uploadId: UPLOAD, message: 'failed', data: { fileName: 'a.png', code: 'LLM_TIMEOUT' } });
    events.seed({ type: 'upload.queued', uploadId: UPLOAD, message: 'queued', data: { fileName: 'a.png' } });
    events.seed({ type: 'extraction.completed', uploadId: UPLOAD, message: 'read', data: { fileName: 'a.png', versionId: '1' } });

    expect((await getLogs()).events.map((event) => [event.message, event.hasDetails])).toEqual([
      ['read', true],
      ['queued', false],
      ['failed', true],
    ]);
  });
});

describe('GET /api/logs/:id/details', () => {
  let uploads: InMemoryUploadStore;

  beforeEach(async () => {
    await app.close();
    uploads = new InMemoryUploadStore();
    app = await buildApp(testAppDeps({ events, uploads }));
  });

  const details = async (id: string) => {
    const response = await app.inject({ method: 'GET', url: logEventDetailsPath(id) });
    return { status: response.statusCode, body: response.json() };
  };

  /** A completed upload read by the AI, as the worker leaves it: the version, and its event. */
  async function readUpload() {
    uploads.seed({ id: UPLOAD, status: 'processing', claimToken: 'claim' });
    const read = await uploads.complete(UPLOAD, 'claim', SAMPLE_EXTRACTION, null);
    return read!.versionId;
  }

  it('shows the data as the AI read it, from the version it saved', async () => {
    const versionId = await readUpload();
    const event = events.seed({ type: 'extraction.completed', uploadId: UPLOAD, message: 'read', data: { versionId } });

    expect(await details(event.id)).toEqual({ status: 200, body: { kind: 'reading', result: SAMPLE_EXTRACTION } });
  });

  it("shows an edit's own record of what it changed, in the order fields are shown", async () => {
    const event = events.seed({
      type: 'upload.edited',
      uploadId: UPLOAD,
      message: 'edited',
      data: { changes: { netWeight: { from: null, to: { value: 1, unit: 'kg' } }, brand: { from: 'Old', to: 'New' } }, checked: ['allergens'] },
    });

    expect((await details(event.id)).body).toEqual({
      kind: 'changes',
      changes: [
        { field: 'brand', from: 'Old', to: 'New' },
        { field: 'netWeight', from: null, to: { value: 1, unit: 'kg' } },
      ],
      checked: ['allergens'],
      unchecked: [],
    });
  });

  it('shows what a revert changed against the version before it, and the checks it undid', async () => {
    const reading = await readUpload();
    const check = { kind: 'checked' as const, by: 'someone', at: new Date() };
    await uploads.saveReview(UPLOAD, 0, { ...SAMPLE_EXTRACTION, brand: 'Edited' }, { brand: check, allergens: check });
    const reverted = await uploads.revert(UPLOAD, 1, reading);
    const event = events.seed({ type: 'upload.reverted', uploadId: UPLOAD, message: 'reverted', data: { versionId: reverted!.versionId } });

    expect((await details(event.id)).body).toEqual({
      kind: 'changes',
      changes: [{ field: 'brand', from: 'Edited', to: SAMPLE_EXTRACTION.brand }],
      checked: [],
      unchecked: ['brand', 'allergens'], // in the order fields are shown
    });
  });

  it("says a change's data is gone once its upload is deleted, and shows other events' facts", async () => {
    const gone = events.seed({ type: 'extraction.completed', uploadId: UPLOAD, message: 'read', data: { versionId: '99' } });
    const failed = events.seed({ type: 'extraction.failed', uploadId: UPLOAD, message: 'failed', data: { code: 'LLM_TIMEOUT' } });

    expect((await details(gone.id)).body).toEqual({ kind: 'gone' });
    expect((await details(failed.id)).body).toEqual({ kind: 'facts', facts: { code: 'LLM_TIMEOUT' } });
  });

  it("is a 404 for an event that doesn't exist, or an ID that can't be one", async () => {
    expect((await details('12345')).status).toBe(404);
    expect((await details('abc')).status).toBe(404);
  });

  it('is for admins only', async () => {
    await app.close();
    app = await buildApp(testAppDeps({ events, uploads, authenticator: signedInAs(MEMBER) }));
    const event = events.seed({ type: 'extraction.failed', message: 'failed', data: { code: 'LLM_TIMEOUT' } });
    expect((await details(event.id)).status).toBe(403);
  });
});
