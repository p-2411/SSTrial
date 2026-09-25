import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { LIVE_EVENTS_PATH } from '@label-extractor/shared';
import type { UploadChangeFeed } from '../../uploads/change-feed.ts';

export interface EventRoutesDeps {
  changes: UploadChangeFeed;
}

/** A comment line every 25 seconds keeps idle connections open through proxies and load balancers. */
const HEARTBEAT_MS = 25_000;

/**
 * GET /api/events (LIVE_EVENTS_PATH) — server-sent events announcing upload changes, so the UI
 * refreshes exactly when something changes instead of polling.
 *
 *   event: upload   data: {"type":"upload","id":"…","status":"completed"}
 *   event: resync   data: {"type":"resync"}     (the server may have missed changes: refetch all)
 */
export async function eventRoutes(app: FastifyInstance, { changes }: EventRoutesDeps) {
  const open = new Set<ServerResponse>();

  // Streams never end on their own, so close them when the server shuts down.
  app.addHook('preClose', async () => {
    for (const response of open) response.end();
  });

  app.get(LIVE_EVENTS_PATH, (request, reply) => {
    // Take over the raw response: Fastify's reply lifecycle expects one response body, not a stream.
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // stop proxies buffering the stream
    });
    // Ask the browser to wait 3 seconds before reconnecting if the stream drops.
    response.write('retry: 3000\n\n');
    open.add(response);

    const unsubscribe = changes.subscribe((change) => {
      response.write(`event: ${change.type}\ndata: ${JSON.stringify(change)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      open.delete(response);
    });
  });
}
