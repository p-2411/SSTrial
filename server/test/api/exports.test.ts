import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/api/app.ts';
import { InMemoryStorage, InMemoryUploadStore, SAMPLE_EXTRACTION, silentLogger } from '../fakes.ts';

let app: App;
let uploads: InMemoryUploadStore;

beforeEach(async () => {
  uploads = new InMemoryUploadStore();
  uploads.seed({ id: 'a0000000-0000-4000-8000-000000000001', fileName: 'done.png', status: 'completed', result: SAMPLE_EXTRACTION });
  uploads.seed({ id: 'a0000000-0000-4000-8000-000000000002', fileName: 'broken.png', status: 'failed', error: { code: 'NO_LABEL_DATA', message: 'x' } });
  uploads.seed({ id: 'a0000000-0000-4000-8000-000000000003', fileName: 'waiting.png', status: 'queued' });
  app = await buildApp({ uploads, storage: new InMemoryStorage(), logger: silentLogger });
});

afterEach(() => app.close());

describe('GET /api/exports/uploads.csv', () => {
  it('downloads a CSV of completed uploads only', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/exports/uploads.csv' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="label-extractions-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = response.body.trim().split('\r\n');
    expect(lines).toHaveLength(2); // header + the one completed upload
    expect(lines[1]).toContain('done.png');
  });
});

describe('GET /api/exports/uploads.json', () => {
  it('downloads JSON of completed uploads only', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/exports/uploads.json' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/filename="label-extractions-.*\.json"/);
    const body = response.json();
    expect(body.uploads).toHaveLength(1);
    expect(body.uploads[0]).toMatchObject({ fileName: 'done.png', productName: SAMPLE_EXTRACTION.productName });
  });
});
