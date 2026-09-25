import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LIVE_EVENTS_PATH, type UploadChange } from '@label-extractor/shared';
import { isLiveConnected, setLiveConnected } from './liveConnection.ts';
import { refreshAllUploads, refreshUpload, refreshUploadLists } from './queries.ts';

/** Changes arriving within this window are refreshed together (e.g. a batch finishing at once). */
const BATCH_MS = 250;

/**
 * Subscribes to the server's live update stream (LIVE_EVENTS_PATH) and refreshes exactly what
 * changed: the lists and counts, plus the detail of each changed upload if it's cached. The browser
 * reconnects automatically if the stream drops; anything missed meanwhile is refetched on reconnect.
 */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return; // e.g. tests: queries keep polling instead

    const source = new EventSource(LIVE_EVENTS_PATH);
    const changed = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshEverything = () => void refreshAllUploads(queryClient);
    const flush = () => {
      flushTimer = undefined;
      void refreshUploadLists(queryClient);
      for (const id of changed) void refreshUpload(queryClient, id);
      changed.clear();
    };

    const on = (type: UploadChange['type'], listener: (event: MessageEvent<string>) => void) =>
      source.addEventListener(type, listener);

    on('upload', (event) => {
      const change = JSON.parse(event.data) as Extract<UploadChange, { type: 'upload' }>;
      changed.add(change.id);
      flushTimer ??= setTimeout(flush, BATCH_MS);
    });
    // The server's own connection to the database dropped and may have missed changes.
    on('resync', refreshEverything);

    source.onopen = () => {
      // (Re)connected: catch up on anything that changed while we weren't listening, then stop polling.
      setLiveConnected(true);
      refreshEverything();
    };
    source.onerror = () => {
      // Dropped: EventSource retries by itself. Refetch now so queries switch back to polling.
      if (isLiveConnected()) {
        setLiveConnected(false);
        refreshEverything();
      }
    };

    return () => {
      source.close();
      clearTimeout(flushTimer);
      setLiveConnected(false);
    };
  }, [queryClient]);
}
