import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isActiveStatus, type UploadDetail, type UploadSummary } from '@label-extractor/shared';
import { ApiRequestError } from './client.ts';
import { getUpload, listUploads, retryUpload } from './uploads.ts';

/**
 * Server state lives in React Query: caching, polling and retries are handled here so
 * components only deal with "loading / error / data".
 */

/** How often to poll while something is still queued or processing. */
export const POLL_INTERVAL_MS = 2_000;

export const uploadKeys = {
  all: ['uploads'] as const,
  list: () => [...uploadKeys.all, 'list'] as const,
  detail: (id: string) => [...uploadKeys.all, 'detail', id] as const,
};

/** Don't retry requests that can't succeed on a second try (e.g. 404), retry others twice. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/** The upload list. Polls only while at least one upload is still in progress. */
export function useUploadList() {
  return useQuery({
    queryKey: uploadKeys.list(),
    queryFn: listUploads,
    retry: retryUnlessClientError,
    refetchInterval: (query) =>
      query.state.data?.some((upload: UploadSummary) => isActiveStatus(upload.status)) ? POLL_INTERVAL_MS : false,
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
      return upload && isActiveStatus(upload.status) ? POLL_INTERVAL_MS : false;
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
      await queryClient.invalidateQueries({ queryKey: uploadKeys.list() });
    },
  });
}
