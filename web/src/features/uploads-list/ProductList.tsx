import { useMemo, useState } from 'react';
import { useMatch } from 'react-router';
import { toast } from 'sonner';
import { Inbox, SearchX } from 'lucide-react';
import { errorMessage } from '@/api/client';
import { useDeleteUploads, useUploadList } from '@/api/queries';
import { NO_PRODUCT_FILTER, type ProductFilter } from '@/api/uploads';
import { DayRangeMenu } from '@/components/DayRangeMenu';
import { EmptyState } from '@/components/EmptyState';
import { InlineError } from '@/components/InlineError';
import { SearchInput } from '@/components/SearchInput';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import { useCloseDetail } from '@/features/upload-detail/UploadDetailPanel';
import { productCount } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useSelection } from '@/lib/useSelection';
import { UPLOAD_PATH_PATTERN } from '@/routes';
import { ExportMenu } from './ExportMenu';
import { ListSkeleton } from './listParts';
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
  // Every page loaded so far, in order. Memoised so it's only a new array when the data changes:
  // the page also re-renders for upload progress and the clock.
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.uploads), [list.data]);
  const ids = useMemo(() => rows?.map((upload) => upload.id) ?? [], [rows]);
  const selection = useSelection(ids);
  const [confirmingDelete, setConfirmingDelete] = useState<string[] | null>(null);
  const { isPending, isError, error, refetch, isRefetching, isPlaceholderData } = list;
  const isFiltered = filter.search !== '' || filter.from !== null || filter.to !== null;
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
              label={picked.length > 0 ? `${productCount(picked.length)} selected` : isFiltered ? 'Products matching the filter' : 'All products'}
            />
          </CardAction>
        )}
      </CardHeader>

      {(ids.length > 0 || isFiltered) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
          <SearchInput
            value={filter.search}
            onSearch={(search) => changeFilter({ search })}
            label="Search products"
            placeholder="Search by product, brand or file"
          />
          <DayRangeMenu label="Added" range={filter} onChange={({ from, to }) => changeFilter({ from, to })} />
        </div>
      )}

      {isError && rows && <StaleDataNotice what="the products" error={error} onRetry={() => void refetch()} retrying={isRefetching} />}

      {rows && rows.length > 0 && (
        // While a new search or filter loads, the last results stay, faded, rather than blinking out.
        <ul aria-busy={isPlaceholderData || undefined} className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {rows.map((upload) => (
            <UploadRow key={upload.id} upload={upload} now={now} selected={selection.isSelected(upload.id)} onSelect={selection.toggle} />
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

      {isError && !rows && (
        <div className="p-4">
          <InlineError title="Couldn't load the products" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        </div>
      )}

      {rows?.length === 0 &&
        (isFiltered ? (
          <EmptyState icon={SearchX} title="No products match" action={{ label: 'Clear filters', onClick: () => changeFilter(NO_PRODUCT_FILTER) }} />
        ) : (
          <EmptyState icon={Inbox} title="No products yet" hint="Upload a label photo or PDF above." />
        ))}

      <DeleteDialog ids={confirmingDelete} onClose={() => setConfirmingDelete(null)} />
    </Card>
  );
}

/**
 * Asks before deleting the picked products, which can't be undone, and stays open until it's done
 * or says why it couldn't be. The server skips any the person may not delete, and the toast says so.
 * If the open product is among those deleted, its panel closes.
 */
function DeleteDialog({ ids, onClose }: { ids: string[] | null; onClose: () => void }) {
  const remove = useDeleteUploads();
  const openId = useMatch(UPLOAD_PATH_PATTERN)?.params.id;
  const closeDetail = useCloseDetail();
  const count = ids?.length ?? 0;

  const confirm = () => {
    if (!ids) return;
    remove.mutate(ids, {
      onSuccess: (deleted) => {
        if (deleted.length > 0) toast.success(`${productCount(deleted.length)} deleted`);
        const skipped = ids.length - deleted.length;
        if (skipped > 0) {
          toast.warning(`${productCount(skipped)} not deleted`, { description: 'Only whoever uploaded a product, or an admin, can delete it.' });
        }
        if (openId && deleted.includes(openId)) closeDetail();
        onClose();
      },
    });
  };
  const onOpenChange = (open: boolean) => {
    if (open || remove.isPending) return; // no walking away mid-delete
    remove.reset();
    onClose();
  };

  return (
    <AlertDialog open={ids !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {productCount(count)}?</AlertDialogTitle>
          <AlertDialogDescription>Their files and extracted data are removed for good. The activity log keeps their history.</AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && (
          <p role="alert" className="text-danger">
            {errorMessage(remove.error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={remove.isPending}>
              Keep them
            </Button>
          </AlertDialogCancel>
          <Button variant="destructive" loading={remove.isPending} onClick={confirm}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
