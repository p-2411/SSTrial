import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtractionConfidence } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import { ADMIN, InMemoryEventStore, InMemoryUploadStore, SAMPLE_EXTRACTION, testAppDeps } from '../fakes.ts';

let app: App;
let uploads: InMemoryUploadStore;

const ID = '4b8c1d2e-0000-4000-8000-000000000001';

beforeEach(async () => {
  uploads = new InMemoryUploadStore();
  app = await buildApp(testAppDeps({ uploads, events: new InMemoryEventStore() }));
  uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION });
});
afterEach(() => app.close());

const patch = (payload: object, id = ID) => app.inject({ method: 'PATCH', url: `/api/uploads/${id}/result`, payload });

describe('PATCH /api/uploads/:id/result', () => {
  it('saves a correction and returns the upload with who made it', async () => {
    const response = await patch({ revision: 0, changes: { brand: 'Hearth & Co' } });

    expect(response.statusCode).toBe(200);
    expect(response.json().upload).toMatchObject({
      result: { brand: 'Hearth & Co' },
      revision: 1,
      fieldReviews: { brand: { kind: 'edited', by: ADMIN.email, at: expect.any(String) } },
    });
  });

  it('explains a value the extraction rules reject', async () => {
    const response = await patch({ revision: 0, changes: { ingredients: [{ name: '', percent: null, subIngredients: [], allergens: [] }] } });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'INVALID_EDIT', message: expect.stringContaining('Ingredients') });
  });

  it("refuses a save made against an older version, so nobody's edit is silently lost", async () => {
    await patch({ revision: 0, changes: { brand: 'First' } });
    const response = await patch({ revision: 0, changes: { brand: 'Second' } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EDIT_CONFLICT');
  });

  it('only edits completed uploads', async () => {
    uploads.seed({ id: ID, status: 'failed', error: { code: 'LLM_TIMEOUT' } });
    const response = await patch({ revision: 0, changes: { brand: 'X' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_EDITABLE');
  });

  it('rejects a malformed request, and answers 404 for an unknown upload', async () => {
    expect((await patch({ changes: { brand: 'X' } })).statusCode).toBe(400);
    expect((await patch({ revision: 0, changes: { colour: 'red' } })).statusCode).toBe(400);
    expect((await patch({ revision: 0, checked: ['brand'] }, '4b8c1d2e-0000-4000-8000-00000000ffff')).statusCode).toBe(404);
  });

  it('stops counting a reviewed field towards the upload’s confidence', async () => {
    const confidence: ExtractionConfidence = {
      productName: { score: 95, reasons: [] },
      brand: { score: 95, reasons: [] },
      netWeight: { score: 40, reasons: ['Blurred.'] },
      allergens: { score: 95, reasons: [] },
      ingredients: { score: 90, reasons: [] },
    };
    uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION, confidence });
    const list = async () => (await app.inject({ method: 'GET', url: '/api/uploads' })).json().uploads[0].confidence;

    expect(await list()).toBe(40);
    await patch({ revision: 0, checked: ['netWeight'] });
    expect(await list()).toBe(90);
  });
});
