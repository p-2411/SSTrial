import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { LIVE_EVENTS_PATH } from '@label-extractor/shared';
import type { ChangeFeed } from '../../infra/change-feed.ts';

export interface EventRoutesDeps {
  changes: ChangeFeed;
}

/** A comment line every 25 seconds keeps idle connections open through proxies and load balancers. */
const HEARTBEAT_MS = 25_000;
/** A stream is ended, so the browser reconnects and its sign-in is checked again, at least this often. */
const REAUTHORISE_MS = 15 * 60_000;

/**
 * GET /api/events (LIVE_EVENTS_PATH) — server-sent events announcing changes, so the UI refreshes
 * exactly when something changes instead of polling.
 *
 *   event: upload   data: {"type":"upload","id":"…","status":"completed"}
 *   event: log      data: {"type":"log"}        (new activity-log events: refetch the log)
 *   event: resync   data: {"type":"resync"}     (the server may have missed changes: refetch all)
 *
 * Like every /api route it needs a signed-in member (the browser sends its token in a header).
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
    // The sign-in was checked when the stream opened. End it before the token runs out (or after
    // REAUTHORISE_MS, whichever is sooner): the browser reconnects with its current token, which is
    // checked again, so an expired sign-in or removed access doesn't keep receiving changes.
    const untilExpiry = request.signedInUntil ? request.signedInUntil.getTime() - Date.now() : Infinity;
    const reauthorise = setTimeout(() => response.end(), Math.max(0, Math.min(REAUTHORISE_MS, untilExpiry)));

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(reauthorise);
      unsubscribe();
      open.delete(response);
    });
  });
}
