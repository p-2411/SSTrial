import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isActiveStatus, type EditResultRequest, type RevertRequest, type UploadDetail, type UploadView } from '@label-extractor/shared';
import { ApiRequestError } from './client.ts';
import { isLiveConnected } from './liveConnection.ts';
import { getUploadHistory, listLogs, type LogFilters } from './logs.ts';
import {
  checkUploads,
  deleteUpload,
  deleteUploads,
  NO_PRODUCT_FILTER,
  type ProductFilter,
  editResult,
  getOpsStatus,
  getUpload,
  listUploads,
  retryUpload,
  revertUpload,
  submitUploads,
} from './uploads.ts';

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
  /** Every list; pass a view for one of them. */
  lists: () => [...uploadKeys.all, 'list'] as const,
  list: (view: UploadView, filter: ProductFilter = NO_PRODUCT_FILTER) => [...uploadKeys.lists(), view, filter] as const,
  detail: (id: string) => [...uploadKeys.all, 'detail', id] as const,
};

export const opsKeys = {
  all: ['ops'] as const,
};

export const logKeys = {
  all: ['logs'] as const,
  list: (filters: LogFilters) => [...logKeys.all, 'list', filters] as const,
  /** One upload's history, on its detail. Under `all`, so new events refresh it like the log. */
  upload: (id: string) => [...logKeys.all, 'upload', id] as const,
};

/** How often the activity log polls when the live update stream is down (it's live otherwise). */
const LOG_POLL_INTERVAL_MS = 10_000;

/** How often the System status page refreshes. */
export const OPS_REFRESH_MS = 15_000;

/** Refetches every upload query: lists and details. For when changes may have been missed. */
export function refreshAllUploads(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: uploadKeys.all });
}

/** Refetches every list: anything that moves an upload between them, or into one. */
export function refreshUploadLists(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
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
 * One of the upload lists (a stage: upload, review, products), filtered and paginated by the server ("Load more" fetches the next
 * page). Polls only while something on screen is still in progress.
 */
export function useUploadList(view: UploadView, filter: ProductFilter = NO_PRODUCT_FILTER) {
  return useInfiniteQuery({
    queryKey: uploadKeys.list(view, filter),
    queryFn: ({ pageParam }) => listUploads(view, pageParam, filter),
    // A new search or filter keeps the last results up until its own arrive.
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (query) =>
      pollWhile(query.state.data?.pages.some((page) => page.uploads.some((upload) => isActiveStatus(upload.status))) ?? false),
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

/** Fetches one upload's detail afresh, whether or not anything is showing it, and caches it. */
export function fetchUpload(queryClient: QueryClient, id: string): Promise<UploadDetail> {
  return queryClient.fetchQuery({ queryKey: uploadKeys.detail(id), queryFn: () => getUpload(id), staleTime: 0 });
}

/** Whether a save was refused because someone else saved a change to the upload first. */
export function isEditConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'EDIT_CONFLICT';
}

/**
 * Save corrections to an upload's data, or confirm fields as right. The cached detail is replaced
 * with the saved one, and the lists refresh (the upload's confidence there may change). When
 * someone else saved first (isEditConflict), the caller decides what to do about it: whether their
 * change matters depends on which field it touched.
 */
export function useEditResult(uploadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: EditResultRequest) => editResult(uploadId, request),
    onSuccess: async (upload) => {
      storeUpload(queryClient, upload);
      await refreshUploadLists(queryClient);
    },
  });
}

/**
 * Review's two actions, on the uploads listed there: submitting those that are ready to Products,
 * and marking every flagged field as checked. Each resolves to the IDs it acted on. Both change
 * uploads' details and history as well as the lists, so everything about uploads is refetched.
 */
export function useSubmitUploads() {
  return useReviewAction(submitUploads);
}

export function useCheckUploads() {
  return useReviewAction(checkUploads);
}

/** Deletes the picked uploads the person may delete. Resolves to the IDs deleted. */
export function useDeleteUploads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUploads,
    onSuccess: async (deleted) => {
      for (const id of deleted) queryClient.removeQueries({ queryKey: uploadKeys.detail(id) });
      await Promise.all([refreshUploadLists(queryClient), refreshLogs(queryClient)]);
    },
  });
}

function useReviewAction(action: (ids: string[]) => Promise<string[]>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => Promise.all([refreshAllUploads(queryClient), refreshLogs(queryClient)]),
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
 * Admins only: put an upload's data back to a version from its history. The reverted upload is
 * cached at once; its history (which gains the revert) and the lists are refetched.
 */
export function useRevertUpload(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RevertRequest) => revertUpload(id, request),
    onSuccess: async (upload) => {
      storeUpload(queryClient, upload);
      await Promise.all([refreshUploadLists(queryClient), queryClient.invalidateQueries({ queryKey: logKeys.upload(id) })]);
    },
  });
}

/**
 * Delete an upload. Its cached detail is dropped rather than refetched, so a panel still showing it
 * (closing, say) keeps its last data instead of flashing "not found"; the lists refresh without it.
 */
export function useDeleteUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUpload,
    onSuccess: async (_nothing, id) => {
      queryClient.removeQueries({ queryKey: uploadKeys.detail(id) });
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
    // A new search or filter keeps the last results up until its own arrive.
    placeholderData: keepPreviousData,
    refetchInterval: () => (isLiveConnected() ? false : LOG_POLL_INTERVAL_MS),
  });
}

/** One upload's history, oldest first. Live like the activity log; polls only without the stream. */
export function useUploadHistory(id: string) {
  return useQuery({
    queryKey: logKeys.upload(id),
    queryFn: () => getUploadHistory(id),
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
