import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CurrentMember } from '@label-extractor/shared';
import { buildApp, type App } from '../../src/api/app.ts';
import type { Authenticator } from '../../src/auth/authenticator.ts';
import { ADMIN, FakeChangeFeed, MEMBER, testAppDeps } from '../fakes.ts';

// Server-sent events need a real socket (inject() waits for a response that never ends), so these
// tests listen on a random port and read the stream with fetch.

let app: App;
let changes: FakeChangeFeed;
let baseUrl: string;
/** When the fake sign-in's token runs out; null means it doesn't say. */
let expiresAt: Date | null;
/** Who the stream is opened by. */
let member: CurrentMember;

beforeEach(async () => {
  changes = new FakeChangeFeed();
  expiresAt = null;
  member = ADMIN;
  const authenticator: Authenticator = { authenticate: async () => ({ outcome: 'signed-in', member, expiresAt }) };
  app = await buildApp(testAppDeps({ changes, authenticator }));
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

    changes.publish({ type: 'upload', id: 'abc', status: 'completed', audience: { product: true, uploaderId: MEMBER.id } });

    // Just what changed: who it's for stays on the server.
    expect(await stream.readUntil('completed')).toContain('event: upload\ndata: {"type":"upload","id":"abc","status":"completed"}\n\n');
    stream.close();
  });

  it("sends a member changes to their own uploads and to products, never to someone else's private upload", async () => {
    member = MEMBER;
    const stream = await openStream();
    await stream.readUntil('retry:');

    changes.publish({ type: 'upload', id: 'theirs', status: 'processing', audience: { product: false, uploaderId: ADMIN.id } });
    changes.publish({ type: 'upload', id: 'legacy', status: 'failed', audience: { product: false, uploaderId: null } });
    changes.publish({ type: 'upload', id: 'mine', status: 'processing', audience: { product: false, uploaderId: MEMBER.id } });
    changes.publish({ type: 'upload', id: 'shared', status: 'queued', audience: { product: true, uploaderId: ADMIN.id } }); // read again
    changes.publish({ type: 'log' });

    const received = await stream.readUntil('"log"');
    expect(received).toContain('"id":"mine"');
    expect(received).toContain('"id":"shared"');
    expect(received).not.toContain('"id":"theirs"');
    expect(received).not.toContain('"id":"legacy"');
    stream.close();
  });

  it("sends an admin changes to uploads from before sign-in, but not to someone else's private upload", async () => {
    const stream = await openStream();
    await stream.readUntil('retry:');

    changes.publish({ type: 'upload', id: 'theirs', status: 'completed', audience: { product: false, uploaderId: MEMBER.id } });
    changes.publish({ type: 'upload', id: 'legacy', status: 'failed', audience: { product: false, uploaderId: null } });
    changes.publish({ type: 'log' });

    const received = await stream.readUntil('"log"');
    expect(received).toContain('"id":"legacy"');
    expect(received).not.toContain('"id":"theirs"');
    stream.close();
  });

  it('ends the stream when the sign-in runs out, so the browser reconnects with a fresh token', async () => {
    expiresAt = new Date(Date.now() + 200);
    const stream = await openStream();

    const received = await stream.readUntil('never sent'); // returns when the server ends the stream
    expect(received).toContain('retry: 3000');
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
