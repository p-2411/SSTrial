import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isLiveConnected, setLiveConnected } from './liveConnection.ts';
import { uploadKeys } from './queries.ts';

/** Changes arriving within this window are refreshed together (e.g. a batch finishing at once). */
const BATCH_MS = 250;

/**
 * Subscribes to the server's live update stream (GET /api/events) and refreshes exactly what
 * changed: the lists and counts, plus the detail of each changed upload if it's cached. The browser
 * reconnects automatically if the stream drops; anything missed meanwhile is refetched on reconnect.
 */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return; // e.g. tests: queries keep polling instead

    const source = new EventSource('/api/events');
    const changed = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshEverything = () => void queryClient.invalidateQueries({ queryKey: uploadKeys.all });
    const flush = () => {
      flushTimer = undefined;
      void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: uploadKeys.counts() });
      for (const id of changed) void queryClient.invalidateQueries({ queryKey: uploadKeys.detail(id) });
      changed.clear();
    };

    source.addEventListener('upload', (event) => {
      changed.add((JSON.parse(event.data) as { id: string }).id);
      flushTimer ??= setTimeout(flush, BATCH_MS);
    });
    // The server's own connection to the database dropped and may have missed changes.
    source.addEventListener('resync', refreshEverything);

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
