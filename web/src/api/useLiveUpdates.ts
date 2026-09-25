import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LIVE_EVENTS_PATH, type LiveChange } from '@label-extractor/shared';
import { authHeaders } from './client.ts';
import { AuthorizedEventSource } from './eventStream.ts';
import { isLiveConnected, setLiveConnected } from './liveConnection.ts';
import { refreshAllUploads, refreshLogs, refreshUpload, refreshUploadLists } from './queries.ts';

/** Changes arriving within this window are refreshed together (e.g. a batch finishing at once). */
const BATCH_MS = 250;

/**
 * Subscribes to the server's live update stream (LIVE_EVENTS_PATH) and refreshes exactly what
 * changed: the lists and counts, plus the detail of each changed upload if it's cached, and the
 * activity log when it has new events. The stream reconnects by itself if it drops (see eventStream.ts);
 * anything missed meanwhile is refetched on reconnect.
 */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new AuthorizedEventSource(LIVE_EVENTS_PATH, authHeaders);
    const changed = new Set<string>();
    let logChanged = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshEverything = () => {
      void refreshAllUploads(queryClient);
      void refreshLogs(queryClient);
    };
    const flush = () => {
      flushTimer = undefined;
      if (changed.size > 0) void refreshUploadLists(queryClient);
      for (const id of changed) void refreshUpload(queryClient, id);
      changed.clear();
      if (logChanged) void refreshLogs(queryClient);
      logChanged = false;
    };
    const scheduleFlush = () => {
      flushTimer ??= setTimeout(flush, BATCH_MS);
    };

    const on = (type: LiveChange['type'], listener: (event: MessageEvent<string>) => void) =>
      source.addEventListener(type, listener);

    on('upload', (event) => {
      const change = JSON.parse(event.data) as Extract<LiveChange, { type: 'upload' }>;
      changed.add(change.id);
      scheduleFlush();
    });
    on('log', () => {
      logChanged = true;
      scheduleFlush();
    });
    // The server's own connection to the database dropped and may have missed changes.
    on('resync', refreshEverything);

    source.onopen = () => {
      // (Re)connected: catch up on anything that changed while we weren't listening, then stop polling.
      setLiveConnected(true);
      refreshEverything();
    };
    source.onerror = () => {
      // Dropped: the stream retries by itself. Refetch now so queries switch back to polling.
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
