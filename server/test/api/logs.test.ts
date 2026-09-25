import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_EVENTS_PATH, type ListLogsResponse } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import { InMemoryEventStore, testAppDeps } from '../fakes.ts';

let app: App;
let events: InMemoryEventStore;

beforeEach(async () => {
  events = new InMemoryEventStore();
  app = await buildApp(testAppDeps({ events }));
  return () => app.close();
});

const UPLOAD = '9e1b7c2a-0000-4000-8000-000000000001';

async function getLogs(query = ''): Promise<ListLogsResponse> {
  const response = await app.inject({ method: 'GET', url: `${LOG_EVENTS_PATH}${query}` });
  expect(response.statusCode).toBe(200);
  return response.json();
}

const messages = (body: ListLogsResponse) => body.events.map((event) => event.message);

describe('GET /api/logs', () => {
  it('returns events newest first, with ISO timestamps', async () => {
    const occurredAt = new Date('2026-09-25T08:00:00Z');
    events.seed({ level: 'info', type: 'process.started', message: 'API started.', occurredAt });
    events.seed({ level: 'info', type: 'upload.created', uploadId: UPLOAD, message: 'label.png started uploading.', data: { fileName: 'label.png' } });

    const body = await getLogs();

    expect(messages(body)).toEqual(['label.png started uploading.', 'API started.']);
    expect(body.events[0]).toEqual({
      id: '2',
      occurredAt: expect.any(String),
      source: 'api',
      level: 'info',
      type: 'upload.created',
      uploadId: UPLOAD,
      message: 'label.png started uploading.',
      data: { fileName: 'label.png' },
    });
    expect(body.events[1]!.occurredAt).toBe('2026-09-25T08:00:00.000Z');
    expect(body.nextCursor).toBeNull();
  });

  it('filters by minimum level, type and upload', async () => {
    events.seed({ level: 'info', type: 'extraction.started', uploadId: UPLOAD, message: 'started' });
    events.seed({ level: 'warn', type: 'extraction.retry_scheduled', uploadId: UPLOAD, message: 'retrying' });
    events.seed({ level: 'error', type: 'extraction.failed', uploadId: UPLOAD, message: 'failed' });
    events.seed({ level: 'error', type: 'alert.opened', message: 'alert' });

    expect(messages(await getLogs('?level=warn'))).toEqual(['alert', 'failed', 'retrying']);
    expect(messages(await getLogs('?level=error'))).toEqual(['alert', 'failed']);
    expect(messages(await getLogs('?type=extraction.started'))).toEqual(['started']);
    expect(messages(await getLogs(`?upload=${UPLOAD}&level=error`))).toEqual(['failed']);
  });

  it('pages through every event exactly once', async () => {
    for (let i = 1; i <= 5; i++) events.seed({ level: 'info', type: 'extraction.started', message: `${i}` });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const body: ListLogsResponse = await getLogs(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...messages(body));
      cursor = body.nextCursor;
    } while (cursor);

    expect(seen).toEqual(['5', '4', '3', '2', '1']);
  });

  it.each([
    ['an unknown level', '?level=debug'],
    ['an unknown type', '?type=upload.exploded'],
    ['a malformed upload ID', '?upload=not-a-uuid'],
    ['a malformed cursor', '?cursor=abc'],
    ['a limit over 200', '?limit=201'],
  ])('rejects %s', async (_label, query) => {
    const response = await app.inject({ method: 'GET', url: `${LOG_EVENTS_PATH}${query}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });
});
