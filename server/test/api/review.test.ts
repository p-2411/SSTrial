import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtractionConfidence, LabelField } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import { ADMIN, InMemoryEventStore, InMemoryUploadStore, MEMBER, SAMPLE_EXTRACTION, signedInAs, testAppDeps } from '../fakes.ts';

let app: App;
let uploads: InMemoryUploadStore;
let events: InMemoryEventStore;

beforeEach(async () => {
  uploads = new InMemoryUploadStore();
  events = new InMemoryEventStore();
  app = await buildApp(testAppDeps({ uploads, events })); // signed in as ADMIN
});
afterEach(() => app.close());

const READY = 'e0000000-0000-4000-8000-000000000001';
const MEDIUM = 'e0000000-0000-4000-8000-000000000002';
const LOW = 'e0000000-0000-4000-8000-000000000003';
const THEIRS = 'e0000000-0000-4000-8000-000000000004';

/** Scores for every field: 95 unless given. */
function scores(overrides: Partial<Record<LabelField, number>> = {}): ExtractionConfidence {
  const score = (field: LabelField) => ({ score: overrides[field] ?? 95, reasons: [] });
  return {
    productName: score('productName'),
    brand: score('brand'),
    netWeight: score('netWeight'),
    allergens: score('allergens'),
    ingredients: score('ingredients'),
  };
}

/** A read upload in someone's Review list. */
function inReview(id: string, confidence: ExtractionConfidence, uploadedBy = ADMIN.id) {
  return uploads.seed({ id, status: 'completed', submittedAt: null, result: SAMPLE_EXTRACTION, confidence, uploadedBy, fileName: `${id.slice(-1)}.png` });
}

const post = (path: 'submit' | 'check', ids: string[]) => app.inject({ method: 'POST', url: `/api/uploads/${path}`, payload: { ids } });

describe('POST /api/uploads/submit', () => {
  it('puts ready uploads into Products, and leaves any with fields still to check in Review', async () => {
    inReview(READY, scores());
    inReview(MEDIUM, scores({ brand: 72 }));
    inReview(LOW, scores({ netWeight: 40 }));

    const response = await post('submit', [READY, MEDIUM, LOW]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ submitted: [READY] });
    expect(uploads.get(READY).submittedAt).toBeInstanceOf(Date);
    expect(uploads.submittedBy.get(READY)).toBe(ADMIN.id);
    expect(uploads.get(MEDIUM).submittedAt).toBeNull();
    expect(uploads.get(LOW).submittedAt).toBeNull();
    expect(events.events).toMatchObject([
      { type: 'upload.submitted', uploadId: READY, message: `${ADMIN.email} added ${SAMPLE_EXTRACTION.productName} (1.png) to Products.` },
    ]);
  });

  it('submits one whose flagged fields a person has checked', async () => {
    inReview(MEDIUM, scores({ brand: 72 }));
    await app.inject({ method: 'PATCH', url: `/api/uploads/${MEDIUM}/result`, payload: { revision: 0, checked: ['brand'] } });

    expect((await post('submit', [MEDIUM])).json()).toEqual({ submitted: [MEDIUM] });
  });

  it("holds back one that wasn't scored until every field is checked, missing required fields flagged as usual", async () => {
    // Say its scores were saved in a shape this version can't read: they read as not scored.
    const unscored = { ...SAMPLE_EXTRACTION, brand: null };
    uploads.seed({ id: READY, status: 'completed', submittedAt: null, result: unscored, confidence: null, uploadedBy: ADMIN.id });

    const [listed] = (await app.inject({ method: 'GET', url: '/api/uploads?view=review' })).json().uploads;
    expect(listed.confidence).toBe(60);
    const detail = (await app.inject({ method: 'GET', url: `/api/uploads/${READY}` })).json().upload;
    expect(detail.fieldConfidence.brand).toEqual({
      score: 60,
      reasons: ['Not scored: check it against the label.', 'No brand was found, and every product needs one.'],
    });
    expect((await post('submit', [READY])).json()).toEqual({ submitted: [] });

    // "Mark all as checked" confirms every field, as a person looking through it would.
    expect((await post('check', [READY])).json()).toEqual({ checked: [READY] });
    expect(Object.keys(uploads.get(READY).fieldReviews)).toHaveLength(5);
    expect((await post('submit', [READY])).json()).toEqual({ submitted: [READY] });
  });

  it("skips what isn't the asker's to submit, or isn't in Review", async () => {
    inReview(THEIRS, scores(), MEMBER.id);
    uploads.seed({ id: READY, status: 'completed', result: SAMPLE_EXTRACTION, uploadedBy: ADMIN.id }); // already in Products
    uploads.seed({ id: MEDIUM, status: 'processing', uploadedBy: ADMIN.id });

    expect((await post('submit', [THEIRS, READY, MEDIUM, 'e0000000-0000-4000-8000-000000000099'])).json()).toEqual({ submitted: [] });
    expect(uploads.get(THEIRS).submittedAt).toBeNull();
    expect(events.events).toEqual([]);
  });

  it('skips one with a saved result that can no longer be read', async () => {
    uploads.seed({ id: READY, status: 'completed', submittedAt: null, result: null, resultUnreadable: true, uploadedBy: ADMIN.id });
    expect((await post('submit', [READY])).json()).toEqual({ submitted: [] });
  });

  it('shows up in Products, for everyone', async () => {
    inReview(READY, scores());
    await post('submit', [READY]);

    await app.close();
    app = await buildApp(testAppDeps({ uploads, events, authenticator: signedInAs(MEMBER) }));
    expect((await app.inject({ method: 'GET', url: '/api/uploads' })).json().uploads).toMatchObject([{ id: READY, submittedAt: expect.any(String) }]);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${READY}` })).statusCode).toBe(200);
  });
});

describe('POST /api/uploads/check', () => {
  it("marks each upload's flagged fields as checked by the asker, and nothing else", async () => {
    inReview(MEDIUM, scores({ brand: 72 }));
    inReview(LOW, scores({ netWeight: 40, allergens: 70 }));
    inReview(READY, scores());

    const response = await post('check', [MEDIUM, LOW, READY]);

    expect(response.json()).toEqual({ checked: [MEDIUM, LOW] });
    expect(Object.keys(uploads.get(MEDIUM).fieldReviews)).toEqual(['brand']);
    expect(Object.keys(uploads.get(LOW).fieldReviews).sort()).toEqual(['allergens', 'netWeight']);
    expect(uploads.get(LOW).fieldReviews.netWeight).toMatchObject({ kind: 'checked', by: ADMIN.id });
    expect(uploads.get(READY).fieldReviews).toEqual({});
    // Each is recorded like any other check, so it's in the upload's history and can be reverted.
    expect(events.events.map((event) => [event.type, event.uploadId])).toEqual([
      ['upload.edited', MEDIUM],
      ['upload.edited', LOW],
    ]);

    // Now nothing's left to check, so all three can go in.
    expect((await post('submit', [MEDIUM, LOW, READY])).json().submitted).toHaveLength(3);
  });

  it("leaves someone else's private upload alone", async () => {
    inReview(THEIRS, scores({ brand: 72 }), MEMBER.id);
    expect((await post('check', [THEIRS])).json()).toEqual({ checked: [] });
    expect(uploads.get(THEIRS).fieldReviews).toEqual({});
  });
});

describe('an upload waiting for review is its uploader’s alone', () => {
  beforeEach(() => inReview(THEIRS, scores({ brand: 72 }), MEMBER.id));

  it('can’t be listed, opened, edited or have its history read by anyone else, admins included', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/uploads?view=review' })).json().uploads).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/uploads' })).json().uploads).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${THEIRS}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${THEIRS}/history` })).statusCode).toBe(404);
    const edit = await app.inject({ method: 'PATCH', url: `/api/uploads/${THEIRS}/result`, payload: { revision: 0, checked: ['brand'] } });
    expect(edit.statusCode).toBe(404);
    expect(uploads.get(THEIRS).fieldReviews).toEqual({});
  });

  it('is open to its uploader', async () => {
    await app.close();
    app = await buildApp(testAppDeps({ uploads, events, authenticator: signedInAs(MEMBER) }));
    expect((await app.inject({ method: 'GET', url: '/api/uploads?view=review' })).json().uploads).toMatchObject([{ id: THEIRS }]);
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${THEIRS}` })).statusCode).toBe(200);
  });

  it("isn't pointed at as a duplicate of someone else's upload of the same file", async () => {
    const hash = 'b'.repeat(64);
    uploads.seed({ ...uploads.get(THEIRS), contentSha256: hash });
    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      payload: { fileName: 'label.png', mimeType: 'image/png', sizeBytes: 5000, sha256: hash },
    });
    expect(response.json().kind).toBe('created');
  });
});

it('reading a product again takes it out of Products until it’s reviewed again', async () => {
  uploads.seed({ id: READY, status: 'completed', result: null, resultUnreadable: true, uploadedBy: ADMIN.id });

  expect((await app.inject({ method: 'POST', url: `/api/uploads/${READY}/retry` })).statusCode).toBe(200);

  expect(uploads.get(READY)).toMatchObject({ status: 'queued', submittedAt: null });
});

it.each([
  ['no IDs', []],
  ['a malformed ID', ['not-an-id']],
  ['more than 100', Array.from({ length: 101 }, (_, i) => `e0000000-0000-4000-8000-${String(i).padStart(12, '0')}`)],
])('rejects %s', async (_label, ids) => {
  for (const path of ['submit', 'check'] as const) {
    const response = await post(path, ids);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  }
});
