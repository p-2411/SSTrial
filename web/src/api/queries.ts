import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import {
  isActiveStatus,
  type EditResultRequest,
  type ListLogsResponse,
  type ListUploadsResponse,
  type RevertRequest,
  type UploadDetail,
  type UploadHistoryResponse,
  type UploadView,
} from '@label-extractor/shared';
import { isLiveConnected } from './liveConnection.ts';
import { getEventDetails, getUploadHistory, listLogs, type ActivityFilters, type EventDetailsSource, type LogFilters } from './logs.ts';
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
 * step through the helpers below rather than touching query keys itself (see refreshAfterChange).
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

const opsKeys = {
  all: ['ops'] as const,
};

export const logKeys = {
  all: ['logs'] as const,
  list: (filters: LogFilters) => [...logKeys.all, 'list', filters] as const,
  /** One upload's history, however filtered, on its detail. Under `all`, so new events refresh it like the log. */
  upload: (id: string) => [...logKeys.all, 'upload', id] as const,
  uploadHistory: (id: string, filters: ActivityFilters) => [...logKeys.upload(id), filters] as const,
};

/** Kept apart from `logKeys`, so new events don't refetch details: an event never changes. */
const eventDetailsKeys = {
  event: (source: EventDetailsSource, eventId: string) => ['event-details', source.uploadId ?? 'log', eventId] as const,
};

/** How often the activity log polls when the live update stream is down (it's live otherwise). */
const LOG_POLL_INTERVAL_MS = 10_000;

/** How often the System page's status strip refreshes. */
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
 * The one rule for keeping the cache in step with a change to uploads, which every mutation
 * follows. The changed upload's own detail comes first: cached from the API's answer when there is
 * one (storeUpload), or dropped when deleted, by the caller. Then:
 *   - every upload list is refetched (a change can move an upload between them, or change a row),
 *     and so are details too (`details`) when several uploads changed and the API didn't send them;
 *   - the activity log and each upload's history are refetched, since every change is recorded
 *     there (histories sit under logKeys.all).
 * Resolves once the lists (and details) are fresh; the activity follows without being waited on.
 * Changes made elsewhere arrive through the live update stream instead (useLiveUpdates).
 */
export function refreshAfterChange(queryClient: QueryClient, { details = false }: { details?: boolean } = {}): Promise<void> {
  void refreshLogs(queryClient);
  return details ? refreshAllUploads(queryClient) : refreshUploadLists(queryClient);
}

/**
 * What every paged list shares ("Load more" fetches the next page, from the cursor the last one
 * gave). A new search or filter keeps the last results up until its own arrive, and the component
 * gets every page loaded so far as one list: `data` is that list, while `hasNextPage` and
 * `fetchNextPage` still work page by page. Made once per kind of list, so `select` is always the
 * same function and the list is only a new array when its pages change (rows are memoised).
 */
function cursorPaged<Page extends { nextCursor: string | null }, Item>(items: (page: Page) => Item[]) {
  return {
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: Page) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    select: (data: InfiniteData<Page, string | undefined>) => data.pages.flatMap(items),
  };
}

const UPLOAD_PAGES = cursorPaged((page: ListUploadsResponse) => page.uploads);
const LOG_PAGES = cursorPaged((page: ListLogsResponse) => page.events);
const HISTORY_PAGES = cursorPaged((page: UploadHistoryResponse) => page.entries);

/**
 * One of the upload lists (a stage: upload, review, products), filtered and paged by the server.
 * Polls only while something on screen is still in progress.
 */
export function useUploadList(view: UploadView, filter: ProductFilter = NO_PRODUCT_FILTER) {
  return useInfiniteQuery({
    queryKey: uploadKeys.list(view, filter),
    queryFn: ({ pageParam }) => listUploads(view, pageParam, filter),
    ...UPLOAD_PAGES,
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

/**
 * Save corrections to an upload's data, or confirm fields as right. The cached detail is replaced
 * with the saved one (see refreshAfterChange). When someone else saved first (see isEditConflict),
 * the caller decides what to do about it: whether their change matters depends on which field it
 * touched.
 */
export function useEditResult(uploadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: EditResultRequest) => editResult(uploadId, request),
    onSuccess: (upload) => {
      storeUpload(queryClient, upload);
      return refreshAfterChange(queryClient);
    },
  });
}

/**
 * Review's two actions, on the uploads listed there: submitting those that are ready to Products,
 * and marking every flagged field as checked. Each resolves to the IDs it acted on. The API sends
 * back no uploads, so their details are refetched too (see refreshAfterChange).
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
    onSuccess: (deleted) => {
      for (const id of deleted) queryClient.removeQueries({ queryKey: uploadKeys.detail(id) });
      return refreshAfterChange(queryClient);
    },
  });
}

function useReviewAction(action: (ids: string[]) => Promise<string[]>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => refreshAfterChange(queryClient, { details: true }),
  });
}

/** Re-queue a failed upload. The cached detail is replaced at once (see refreshAfterChange). */
export function useRetryUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryUpload,
    onSuccess: (upload) => {
      storeUpload(queryClient, upload);
      return refreshAfterChange(queryClient);
    },
  });
}

/**
 * Admins only: put an upload's data back to a version from its history. The reverted upload is
 * cached at once, and its history gains the revert (see refreshAfterChange).
 */
export function useRevertUpload(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RevertRequest) => revertUpload(id, request),
    onSuccess: (upload) => {
      storeUpload(queryClient, upload);
      return refreshAfterChange(queryClient);
    },
  });
}

/**
 * Delete an upload. Its cached detail is dropped rather than refetched, so a panel still showing it
 * (closing, say) doesn't warn that it has been deleted (see refreshAfterChange).
 */
export function useDeleteUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUpload,
    onSuccess: (_nothing, id) => {
      queryClient.removeQueries({ queryKey: uploadKeys.detail(id) });
      return refreshAfterChange(queryClient);
    },
  });
}

/**
 * The activity log, newest first, filtered and paged by the server ("Load more" fetches older
 * events). Live: new events arrive through the update stream, which refetches it (useLiveUpdates).
 */
export function useActivityLog(filters: LogFilters) {
  return useInfiniteQuery({
    queryKey: logKeys.list(filters),
    queryFn: ({ pageParam }) => listLogs(filters, pageParam),
    ...LOG_PAGES,
    refetchInterval: () => (isLiveConnected() ? false : LOG_POLL_INTERVAL_MS),
  });
}

/**
 * One upload's history, newest first, filtered and paged by the server like the activity log.
 * Live like it too; polls only without the stream.
 */
export function useUploadHistory(id: string, filters: ActivityFilters) {
  return useInfiniteQuery({
    queryKey: logKeys.uploadHistory(id, filters),
    queryFn: ({ pageParam }) => getUploadHistory(id, filters, pageParam),
    ...HISTORY_PAGES,
    refetchInterval: () => (isLiveConnected() ? false : LOG_POLL_INTERVAL_MS),
  });
}

/**
 * One event's details. Only asked for once they're opened (EventDetails mounts then), never
 * before. An event never changes once written, so they're fetched once and kept while the page is
 * open.
 */
export function useEventDetails(source: EventDetailsSource, eventId: string) {
  return useQuery({
    queryKey: eventDetailsKeys.event(source, eventId),
    queryFn: () => getEventDetails(source, eventId),
    staleTime: Infinity,
  });
}

/** The System page's status strip. Refreshes on a timer: monitoring data changes by the minute. */
export function useOpsStatus() {
  return useQuery({
    queryKey: opsKeys.all,
    queryFn: getOpsStatus,
    refetchInterval: OPS_REFRESH_MS,
  });
}
