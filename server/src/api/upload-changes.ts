import type postgres from 'postgres';
import type { UploadStatus } from '@label-extractor/shared';
import type { Logger } from '../infra/logger.ts';

/**
 * A live feed of upload changes, fed by the database: a trigger on `uploads` NOTIFYs the
 * 'upload_changes' channel and this process LISTENs. Changes made by any process — this API,
 * another API instance, a worker — reach every connected browser.
 */
export type UploadChange =
  | { type: 'upload'; id: string; status: UploadStatus }
  /** The feed reconnected and may have missed changes: browsers should refetch everything. */
  | { type: 'resync' };

export interface UploadChangeFeed {
  /** Calls `listener` for every change until the returned function is called. */
  subscribe(listener: (change: UploadChange) => void): () => void;
}

export async function listenForUploadChanges(sql: postgres.Sql, logger: Logger): Promise<UploadChangeFeed> {
  const listeners = new Set<(change: UploadChange) => void>();
  const publish = (change: UploadChange) => listeners.forEach((listener) => listener(change));
  let connectedBefore = false;

  // postgres.js keeps a dedicated connection for LISTEN and re-establishes it if it drops; it calls
  // the third argument after every (re)connect.
  await sql.listen(
    'upload_changes',
    (payload) => {
      try {
        const { id, status } = JSON.parse(payload) as { id: string; status: UploadStatus };
        publish({ type: 'upload', id, status });
      } catch (err) {
        logger.warn({ err, payload }, 'Ignored an unreadable upload change notification');
      }
    },
    () => {
      if (connectedBefore) {
        logger.warn('Reconnected to upload change notifications; asking browsers to resync');
        publish({ type: 'resync' });
      }
      connectedBefore = true;
    },
  );

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
