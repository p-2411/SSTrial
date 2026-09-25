import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/api/app.ts';
import { FakeChangeFeed, testAppDeps } from '../fakes.ts';

// Server-sent events need a real socket (inject() waits for a response that never ends), so these
// tests listen on a random port and read the stream with fetch.

let app: App;
let changes: FakeChangeFeed;
let baseUrl: string;

beforeEach(async () => {
  changes = new FakeChangeFeed();
  app = await buildApp(testAppDeps({ changes }));
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(() => app.close());

/** Opens the stream and returns a reader that yields text until it contains `text`. */
async function openStream() {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let received = '';
  return {
    response,
    close: () => controller.abort(),
    async readUntil(text: string) {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value;
      }
      return received;
    },
  };
}

describe('GET /api/events', () => {
  it('streams upload changes as server-sent events', async () => {
    const stream = await openStream();
    expect(stream.response.headers.get('content-type')).toBe('text/event-stream');
    await stream.readUntil('retry: 3000');

    changes.publish({ type: 'upload', id: 'abc', status: 'completed' });

    expect(await stream.readUntil('completed')).toContain('event: upload\ndata: {"type":"upload","id":"abc","status":"completed"}\n\n');
    stream.close();
  });

  it('announces new activity-log events', async () => {
    const stream = await openStream();
    await stream.readUntil('retry:');

    changes.publish({ type: 'log' });

    expect(await stream.readUntil('"log"')).toContain('event: log\ndata: {"type":"log"}\n\n');
    stream.close();
  });

  it('tells browsers to resync when the server may have missed changes', async () => {
    const stream = await openStream();
    await stream.readUntil('retry:');

    changes.publish({ type: 'resync' });

    expect(await stream.readUntil('resync')).toContain('event: resync');
    stream.close();
  });

  it('stops listening when the browser disconnects', async () => {
    const stream = await openStream();
    await stream.readUntil('retry:');
    expect(changes.subscribers).toBe(1);

    stream.close();

    await expect.poll(() => changes.subscribers).toBe(0);
  });

  it('ends open streams when the server shuts down, instead of hanging', async () => {
    const stream = await openStream();
    await stream.readUntil('retry:');

    await app.close(); // would never resolve if the stream kept the server open
    expect(changes.subscribers).toBe(0);
  });
});
