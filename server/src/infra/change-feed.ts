import type postgres from 'postgres';
import { isUploadStatus, type LiveChange } from '@label-extractor/shared';
import type { Logger } from './logger.ts';

/**
 * A live feed of changes, fed by the database: triggers NOTIFY a channel and this process LISTENs.
 * Changes made by any process — this API, another API instance, a worker — reach every connected
 * browser.
 *
 *   'upload_changes'  an upload changed status (trigger on `uploads`)
 *   'new_events'      new events were written to the activity log (trigger on `events`)
 */
export interface ChangeFeed {
  /** Calls `listener` for every change until the returned function is called. */
  subscribe(listener: (change: LiveChange) => void): () => void;
}

export async function listenForChanges(sql: postgres.Sql, logger: Logger): Promise<ChangeFeed> {
  const listeners = new Set<(change: LiveChange) => void>();
  const publish = (change: LiveChange) => listeners.forEach((listener) => listener(change));

  /**
   * postgres.js keeps a dedicated connection for LISTEN and re-establishes it if it drops; it calls
   * `onlisten` after every (re)connect. Anything sent while it was down is lost, so a reconnect asks
   * browsers to refetch everything.
   */
  async function listen(channel: string, toChange: (payload: string) => LiveChange | null) {
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

/** The uploads trigger sends `{"id": …, "status": …}`; anything else is ignored rather than passed on. */
function parseUploadChange(payload: string): LiveChange | null {
  try {
    const { id, status } = JSON.parse(payload) as { id?: unknown; status?: unknown };
    if (typeof id !== 'string' || typeof status !== 'string' || !isUploadStatus(status)) return null;
    return { type: 'upload', id, status };
  } catch {
    return null;
  }
}
