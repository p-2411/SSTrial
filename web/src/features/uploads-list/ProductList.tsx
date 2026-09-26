import { useMemo, useState } from 'react';
import { Inbox, SearchX } from 'lucide-react';
import { errorMessage } from '@/api/client';
import { isFiltered } from '@/api/filters';
import { useUploadList } from '@/api/queries';
import { NO_PRODUCT_FILTER, type ProductFilter } from '@/api/uploads';
import { EmptyState } from '@/components/EmptyState';
import { FadeWhileLoading } from '@/components/FadeWhileLoading';
import { InlineError } from '@/components/InlineError';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import { productCount } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useSelection } from '@/lib/useSelection';
import { DeleteProductsDialog } from './DeleteProductsDialog';
import { ExportMenu } from './ExportMenu';
import { ListSkeleton } from './ListSkeleton';
import { ProductFilterBar } from './ProductFilterBar';
import { ScrollingList } from './ScrollingList';
import { UploadRow } from './UploadRow';

/**
 * Everyone's products: the shared, lasting list. Uploads being read, failed or waiting for review
 * are their uploader's alone (see YourUploads), and only arrive here once submitted.
 *
 * Searchable (name, brand or file name) and filterable by when products were added, by the server.
 * Products can be picked (a row's box shows on hover) to export or delete together; with none
 * picked, Export takes every product the search and filter match.
 */
export function ProductList() {
  const [filter, setFilter] = useState<ProductFilter>(NO_PRODUCT_FILTER);
  const list = useUploadList('products', filter);
  const now = useNow();
  const rows = list.data; // every page loaded so far
  const ids = useMemo(() => rows?.map((upload) => upload.id) ?? [], [rows]);
  const selection = useSelection(ids);
  const [confirmingDelete, setConfirmingDelete] = useState<string[] | null>(null);
  const { isPending, isError, isRefetchError, error, refetch, isRefetching, isPlaceholderData } = list;
  const filtered = isFiltered(filter);
  const picked = selection.selected;

  const changeFilter = (changes: Partial<ProductFilter>) => {
    selection.clear(); // what was picked may not be listed any more
    setFilter((current) => ({ ...current, ...changes }));
  };

  return (
    <Card aria-labelledby="products-heading" className="gap-0 py-0" role="region">
      <CardHeader className="border-b border-border/70 py-4">
        <div className="flex h-8 items-center gap-3">
          <CardTitle id="products-heading" className="text-base font-semibold">
            Products
          </CardTitle>
          {picked.length > 0 && <span className="text-sm text-muted-foreground">{picked.length} selected</span>}
        </div>
        {ids.length > 0 && (
          <CardAction className="flex items-center gap-2">
            {picked.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="border-danger-border bg-transparent text-danger hover:bg-danger-soft hover:text-danger"
                onClick={() => setConfirmingDelete(picked)}
              >
                Delete
              </Button>
            )}
            <ExportMenu
              products={picked.length > 0 ? { ids: picked } : filter}
              label={picked.length > 0 ? `${productCount(picked.length)} selected` : filtered ? 'Products matching the filter' : 'All products'}
            />
          </CardAction>
        )}
      </CardHeader>

      {(ids.length > 0 || filtered) && <ProductFilterBar filter={filter} onChange={changeFilter} />}

      {isRefetchError && <StaleDataNotice what="the products" error={error} onRetry={() => void refetch()} retrying={isRefetching} />}

      <ScrollingList>
        {rows && rows.length > 0 && (
          <FadeWhileLoading loading={isPlaceholderData}>
            <ul>
              {rows.map((upload) => (
                <UploadRow key={upload.id} upload={upload} now={now} selected={selection.isSelected(upload.id)} onSelect={selection.toggle} />
              ))}
            </ul>
          </FadeWhileLoading>
        )}
        <LoadMoreButton query={list} className="border-t border-border/70 p-3" />
      </ScrollingList>

      {isPending && <ListSkeleton label="Loading products" />}

      {isError && !rows && (
        <div className="p-4">
          <InlineError title="Couldn't load the products" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        </div>
      )}

      {rows?.length === 0 &&
        (filtered ? (
          <EmptyState icon={SearchX} title="No products match" action={{ label: 'Clear filters', onClick: () => changeFilter(NO_PRODUCT_FILTER) }} />
        ) : (
          <EmptyState icon={Inbox} title="No products yet" hint="Upload a label photo or PDF above." />
        ))}

      <DeleteProductsDialog ids={confirmingDelete} onClose={() => setConfirmingDelete(null)} />
    </Card>
  );
}
