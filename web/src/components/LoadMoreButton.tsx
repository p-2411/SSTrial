import { errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** What LoadMoreButton needs of a paged query (React Query's useInfiniteQuery result). */
interface PagedQuery {
  hasNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  error: unknown;
}

/**
 * "Load more" under a paged list, while there's more to load. If the next page couldn't be
 * fetched it says so beside the button, which tries again; the rows already shown stay as they are.
 */
export function LoadMoreButton({ query, className }: { query: PagedQuery; className?: string }) {
  if (!query.hasNextPage) return null;
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1', className)}>
      <Button variant="ghost" size="sm" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
        Load more
      </Button>
      {query.isFetchNextPageError && !query.isFetchingNextPage && (
        <p role="alert" className="text-sm text-danger">
          Couldn't load more. {errorMessage(query.error)}
        </p>
      )}
    </div>
  );
}
