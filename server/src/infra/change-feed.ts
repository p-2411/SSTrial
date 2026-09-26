import type postgres from 'postgres';
import { isUploadStatus, type LiveChange, type UploadOwnership } from '@label-extractor/shared';
import type { Logger } from './logger.ts';

/**
 * A live feed of changes, fed by the database: triggers NOTIFY a channel and this process LISTENs.
 * Changes made by any process — this API, another API instance, a worker — reach every connected
 * browser.
 *
 *   'upload_changes'  an upload changed (trigger on `uploads`), with who may see it
 *   'new_events'      new events were written to the activity log (trigger on `events`)
 */
export interface ChangeFeed {
  /** Calls `listener` for every change until the returned function is called. */
  subscribe(listener: (change: FeedChange) => void): () => void;
}

/**
 * A change as the feed carries it: what browsers are sent, and for an upload, whose it is, so it's
 * only sent to people who may see it (see api/routes/events.ts). `audience.product` says whether
 * it's in Products before or after the change: everyone who could see it hears that it left.
 */
export type FeedChange =
  | (Extract<LiveChange, { type: 'upload' }> & { audience: UploadOwnership })
  | Exclude<LiveChange, { type: 'upload' }>;

export async function listenForChanges(sql: postgres.Sql, logger: Logger): Promise<ChangeFeed> {
  const listeners = new Set<(change: FeedChange) => void>();
  const publish = (change: FeedChange) => listeners.forEach((listener) => listener(change));

  /**
   * postgres.js keeps a dedicated connection for LISTEN and re-establishes it if it drops; it calls
   * `onlisten` after every (re)connect. Anything sent while it was down is lost, so a reconnect asks
   * browsers to refetch everything.
   */
  async function listen(channel: string, toChange: (payload: string) => FeedChange | null) {
    let connectedBefore = false;
    await sql.listen(
      channel,
      (payload) => {
        const change = toChange(payload);
        if (change) publish(change);
        else logger.warn({ channel, payload }, 'Ignored an unreadable change notification');
      },
      () => {
        if (connectedBefore) {
          logger.warn({ channel }, 'Reconnected to change notifications; asking browsers to resync');
          publish({ type: 'resync' });
        }
        connectedBefore = true;
      },
    );
  }

  await listen('upload_changes', parseUploadChange);
  await listen('new_events', () => ({ type: 'log' }));

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The uploads trigger sends `{"id", "status", "uploadedBy", "product"}`; anything else is ignored
 * rather than passed on. Who it's for, if not said, falls back to admins only (an upload with no
 * uploader, and not in Products), never to everyone.
 */
function parseUploadChange(payload: string): FeedChange | null {
  try {
    const { id, status, uploadedBy, product } = JSON.parse(payload) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof status !== 'string' || !isUploadStatus(status)) return null;
    const audience = { product: product === true, uploaderId: typeof uploadedBy === 'string' ? uploadedBy : null };
    return { type: 'upload', id, status, audience };
  } catch {
    return null;
  }
}
