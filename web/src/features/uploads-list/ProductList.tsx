import { useMemo } from 'react';
import { Inbox } from 'lucide-react';
import { errorMessage } from '@/api/client';
import { useUploadList } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import { useNow } from '@/lib/useNow';
import { ExportMenu } from './ExportMenu';
import { ListSkeleton, StaleListBanner } from './listParts';
import { UploadRow } from './UploadRow';

/**
 * Everyone's finished products: the shared, lasting list. Uploads still under way, or failed, are
 * their uploader's alone (see YourUploads) and only arrive here once they're done.
 */
export function ProductList() {
  const list = useUploadList('products');
  const now = useNow();
  // Every page loaded so far, in order. Memoised so it's only a new array when the data changes:
  // the page also re-renders for upload progress and the clock.
  const products = useMemo(() => list.data?.pages.flatMap((page) => page.uploads), [list.data]);
  const { isPending, isError, error, refetch, isRefetching } = list;

  return (
    <Card aria-labelledby="products-heading" className="gap-0 py-0" role="region">
      <CardHeader className="border-b border-border/70 py-4">
        <CardTitle id="products-heading" className="text-base font-semibold">
          Products
        </CardTitle>
        {products && products.length > 0 && (
          <CardAction>
            <ExportMenu />
          </CardAction>
        )}
      </CardHeader>

      {isError && products && <StaleListBanner error={error} />}

      {products && products.length > 0 && (
        <ul>
          {products.map((upload) => (
            <UploadRow key={upload.id} upload={upload} now={now} />
          ))}
        </ul>
      )}

      {list.hasNextPage && (
        <div className="border-t border-border/70 p-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}

      {isPending && <ListSkeleton label="Loading products" />}

      {isError && !products && (
        <div className="p-4">
          <InlineError title="Couldn't load the products" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        </div>
      )}

      {products?.length === 0 && <EmptyState />}
    </Card>
  );
}

/** Nothing has been read yet: say how to start. */
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="size-5" aria-hidden />
      </span>
      <p className="font-semibold">No products yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Add a label photo or PDF above. Once it's been read, its product name, brand, ingredients, allergens and net
        weight appear here.
      </p>
    </div>
  );
}
