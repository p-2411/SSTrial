import { beforeEach, describe, expect, it } from 'vitest';
import type { EditResultRequest } from '@label-extractor/shared';
import { editResult } from '../../src/uploads/edit.ts';
import { ADMIN, InMemoryEventStore, InMemoryUploadStore, SAMPLE_EXTRACTION } from '../fakes.ts';

const ID = '9e1d2f3a-0000-4000-8000-000000000001';
const AT = new Date('2026-09-26T10:00:00Z');

let uploads: InMemoryUploadStore;
let events: InMemoryEventStore;

beforeEach(() => {
  uploads = new InMemoryUploadStore();
  events = new InMemoryEventStore();
  uploads.seed({ id: ID, status: 'completed', result: SAMPLE_EXTRACTION, fileName: 'granola.png' });
});

const edit = (request: EditResultRequest) => editResult({ uploads, events, now: () => AT }, ID, request, ADMIN);

describe('editResult', () => {
  it('saves a corrected field and records who corrected it', async () => {
    const outcome = await edit({ revision: 0, changes: { brand: 'Hearth & Co' } });

    expect(outcome.outcome).toBe('saved');
    expect(uploads.get(ID)).toMatchObject({
      result: { ...SAMPLE_EXTRACTION, brand: 'Hearth & Co' },
      fieldReviews: { brand: { kind: 'edited', by: ADMIN.id, at: AT } },
      resultRevision: 1,
    });
    expect(events.events.at(-1)).toMatchObject({
      type: 'upload.edited',
      uploadId: ID,
      message: 'admin@example.com changed the brand of granola.png.',
      data: { by: 'admin@example.com', changes: { brand: { from: 'Harvest & Hearth', to: 'Hearth & Co' } } },
    });
  });

  it('marks a field as checked without changing it', async () => {
    await edit({ revision: 0, checked: ['netWeight'] });

    expect(uploads.get(ID)).toMatchObject({
      result: SAMPLE_EXTRACTION,
      fieldReviews: { netWeight: { kind: 'checked', by: ADMIN.id } },
      resultRevision: 1,
    });
    expect(events.events.at(-1)!.message).toBe('admin@example.com confirmed the net weight of granola.png.');
  });

  it('validates the edited result with the same rules as model output', async () => {
    const outcome = await edit({ revision: 0, changes: { netWeight: { value: -5, unit: 'g' } } });

    expect(outcome).toMatchObject({ outcome: 'invalid', message: expect.stringContaining('Net weight') });
    expect(uploads.get(ID).resultRevision).toBe(0);
  });

  it('refuses an edit made against an older revision, and returns the latest', async () => {
    await edit({ revision: 0, changes: { brand: 'First' } });

    const outcome = await edit({ revision: 0, changes: { brand: 'Second' } });
    expect(outcome).toMatchObject({ outcome: 'conflict', upload: { result: { brand: 'First' }, resultRevision: 1 } });
  });

  it('only edits completed uploads whose result can be read', async () => {
    uploads.seed({ id: ID, status: 'failed', error: { code: 'LLM_TIMEOUT' } });
    await expect(edit({ revision: 0, changes: { brand: 'X' } })).resolves.toEqual({ outcome: 'not-editable' });

    uploads.seed({ id: ID, status: 'completed', result: null, resultUnreadable: true });
    await expect(edit({ revision: 0, changes: { brand: 'X' } })).resolves.toEqual({ outcome: 'not-editable' });
  });

  it('saves nothing when every change leaves its field as it was', async () => {
    const outcome = await edit({ revision: 0, changes: { brand: 'Harvest & Hearth' } });

    expect(outcome.outcome).toBe('saved');
    expect(uploads.get(ID)).toMatchObject({ resultRevision: 0, fieldReviews: {} });
    expect(events.events).toHaveLength(0);
  });

  it("drops an ingredient's link to an allergen removed from the list, without calling the ingredients edited", async () => {
    await edit({ revision: 0, changes: { allergens: ['oats'] } });

    const { result, fieldReviews } = uploads.get(ID);
    expect(result!.ingredients.find((i) => i.name === 'Pecans')!.allergens).toEqual([]);
    expect(Object.keys(fieldReviews)).toEqual(['allergens']);
  });

  it("keeps the pack's printed wording when it shows the corrected amount", async () => {
    uploads.seed({ id: ID, status: 'completed', result: { ...SAMPLE_EXTRACTION, netWeight: { value: 16, unit: 'oz', text: 'Net Wt 16 oz (454 g)' } } });
    await edit({ revision: 0, changes: { netWeight: { value: 454, unit: 'g' } } });
    expect(uploads.get(ID).result!.netWeight).toEqual({ value: 454, unit: 'g', text: 'Net Wt 16 oz (454 g)' });
  });

  it("replaces the printed wording when it doesn't show the corrected amount (it was misread too), or there was none", async () => {
    await edit({ revision: 0, changes: { netWeight: { value: 450, unit: 'g' } } });
    expect(uploads.get(ID).result!.netWeight).toEqual({ value: 450, unit: 'g', text: '450 g' });

    uploads.seed({ id: ID, status: 'completed', result: { ...SAMPLE_EXTRACTION, netWeight: null } });
    await edit({ revision: 0, changes: { netWeight: { value: 1.5, unit: 'l' } } });
    expect(uploads.get(ID).result!.netWeight).toEqual({ value: 1.5, unit: 'l', text: '1.5 l' });
  });

  it('reports an upload that no longer exists', async () => {
    uploads.rows.clear();
    await expect(edit({ revision: 0, checked: ['brand'] })).resolves.toEqual({ outcome: 'not-found' });
  });
});
