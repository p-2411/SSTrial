import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isActiveStatus, type UploadDetail, type UploadFilter } from '@label-extractor/shared';
import { isLiveConnected } from './liveConnection.ts';
import { listLogs, type LogFilters } from './logs.ts';
import { getOpsStatus, getUpload, getUploadCounts, listUploads, retryUpload } from './uploads.ts';

/**
 * Server state lives in React Query: caching, polling and retries are handled here so
 * components only deal with "loading / error / data". Code that changes uploads keeps the cache in
 * step through the helpers below rather than touching query keys itself.
 */

/**
 * How often to poll while something is still queued or processing — only as a fallback: while the
 * live update stream is connected, the server pushes changes and nothing polls.
 */
const POLL_INTERVAL_MS = 2_000;

/** Poll interval for a query: never while live updates are connected, otherwise while `active`. */
function pollWhile(active: boolean): number | false {
  return active && !isLiveConnected() ? POLL_INTERVAL_MS : false;
}

export const uploadKeys = {
  all: ['uploads'] as const,
  /** Every filtered list; pass a filter for one of them. */
  lists: () => [...uploadKeys.all, 'list'] as const,
  list: (filter: UploadFilter) => [...uploadKeys.lists(), filter] as const,
  counts: () => [...uploadKeys.all, 'counts'] as const,
  detail: (id: string) => [...uploadKeys.all, 'detail', id] as const,
};

export const opsKeys = {
  all: ['ops'] as const,
};

export const logKeys = {
  all: ['logs'] as const,
  list: (filters: LogFilters) => [...logKeys.all, 'list', filters] as const,
};

/** How often the activity log polls when the live update stream is down (it's live otherwise). */
const LOG_POLL_INTERVAL_MS = 10_000;

/** How often the System status page refreshes. */
export const OPS_REFRESH_MS = 15_000;

/** Refetches every upload query: lists, counts and details. For when changes may have been missed. */
export function refreshAllUploads(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: uploadKeys.all });
}

/** Refetches the list views and their counts: anything that moves an upload between views. */
export async function refreshUploadLists(queryClient: QueryClient): Promise<void> {
  // Independent refetches: run them side by side rather than one after the other.
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: uploadKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: uploadKeys.counts() }),
  ]);
}

/** Refetches just the per-view counts, e.g. the tab numbers beside a list that's being switched. */
export function refreshUploadCounts(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: uploadKeys.counts() });
}

/** Refetches the activity log, in whichever views of it are cached. */
export function refreshLogs(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: logKeys.all });
}

/** Refetches one upload's detail, if it's cached. */
export function refreshUpload(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: uploadKeys.detail(id) });
}

/** Caches an upload the API just returned, so its detail shows without another request. */
export function storeUpload(queryClient: QueryClient, upload: UploadDetail): void {
  queryClient.setQueryData(uploadKeys.detail(upload.id), upload);
}

/**
 * One view of the upload list, filtered and paginated by the server ("Load more" fetches the next
 * page). Polls only while something on screen is still in progress.
 */
export function useUploadList(filter: UploadFilter) {
  return useInfiniteQuery({
    queryKey: uploadKeys.list(filter),
    queryFn: ({ pageParam }) => listUploads(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (query) =>
      pollWhile(query.state.data?.pages.some((page) => page.uploads.some((upload) => isActiveStatus(upload.status))) ?? false),
  });
}

/** How many uploads each view holds, counted by the server. Polls while anything is in progress. */
export function useUploadCounts() {
  return useQuery({
    queryKey: uploadKeys.counts(),
    queryFn: getUploadCounts,
    refetchInterval: (query) => pollWhile((query.state.data?.['in-progress'] ?? 0) > 0),
  });
}

/** One upload with its extracted data. Polls until it reaches a final state. */
export function useUploadDetail(id: string) {
  return useQuery({
    queryKey: uploadKeys.detail(id),
    queryFn: () => getUpload(id),
    refetchInterval: (query) => {
      const upload = query.state.data as UploadDetail | undefined;
      return pollWhile(upload !== undefined && isActiveStatus(upload.status));
    },
  });
}

/** Re-queue a failed upload. Updates the cached detail immediately and refreshes the list. */
export function useRetryUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryUpload,
    onSuccess: async (upload) => {
      storeUpload(queryClient, upload);
      await refreshUploadLists(queryClient);
    },
  });
}

/**
 * The activity log, newest first, filtered and paginated by the server ("Load more" fetches older
 * events). Live: new events arrive through the update stream, which refetches it (useLiveUpdates).
 */
export function useLogs(filters: LogFilters) {
  return useInfiniteQuery({
    queryKey: logKeys.list(filters),
    queryFn: ({ pageParam }) => listLogs(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: () => (isLiveConnected() ? false : LOG_POLL_INTERVAL_MS),
  });
}

/** Everything on the System status page. Refreshes on a timer: monitoring data changes by the minute. */
export function useOpsStatus() {
  return useQuery({
    queryKey: opsKeys.all,
    queryFn: getOpsStatus,
    refetchInterval: OPS_REFRESH_MS,
  });
}
