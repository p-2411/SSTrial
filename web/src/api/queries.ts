import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isActiveStatus, type UploadDetail, type UploadFilter } from '@label-extractor/shared';
import { ApiRequestError } from './client.ts';
import { isLiveConnected } from './liveConnection.ts';
import { getUpload, getUploadCounts, listUploads, retryUpload } from './uploads.ts';

/**
 * Server state lives in React Query: caching, polling and retries are handled here so
 * components only deal with "loading / error / data".
 */

/**
 * How often to poll while something is still queued or processing — only as a fallback: while the
 * live update stream is connected, the server pushes changes and nothing polls.
 */
export const POLL_INTERVAL_MS = 2_000;

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

/** Don't retry requests that can't succeed on a second try (e.g. 404), retry others twice. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
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
    retry: retryUnlessClientError,
    refetchInterval: (query) =>
      pollWhile(query.state.data?.pages.some((page) => page.uploads.some((upload) => isActiveStatus(upload.status))) ?? false),
  });
}

/** How many uploads each view holds, counted by the server. Polls while anything is in progress. */
export function useUploadCounts() {
  return useQuery({
    queryKey: uploadKeys.counts(),
    queryFn: getUploadCounts,
    retry: retryUnlessClientError,
    refetchInterval: (query) => pollWhile((query.state.data?.['in-progress'] ?? 0) > 0),
  });
}

/** One upload with its extracted data. Polls until it reaches a final state. */
export function useUploadDetail(id: string) {
  return useQuery({
    queryKey: uploadKeys.detail(id),
    queryFn: () => getUpload(id),
    retry: retryUnlessClientError,
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
      queryClient.setQueryData(uploadKeys.detail(upload.id), upload);
      await queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
      await queryClient.invalidateQueries({ queryKey: uploadKeys.counts() });
    },
  });
}
