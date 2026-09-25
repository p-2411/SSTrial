import { QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { ApiRequestError } from './client.ts';

/** Don't retry requests that can't succeed on a second try (e.g. 404), retry others twice. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * The app's React Query client. Tests build theirs here too, so they run with the same defaults,
 * adjusting only what they need (e.g. no delay between retries).
 */
export function createQueryClient(queries: DefaultOptions['queries'] = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is polled explicitly where it matters, so treat it as briefly fresh everywhere else.
        staleTime: 5_000,
        retry: retryUnlessClientError,
        ...queries,
      },
    },
  });
}
