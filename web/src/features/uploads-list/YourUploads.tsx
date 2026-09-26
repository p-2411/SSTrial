import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { errorMessage } from '@/api/client';
import { useUploadList } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import { PendingUploadRow } from '@/features/upload/PendingUploadRow';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { useNow } from '@/lib/useNow';
import { StaleListBanner } from './listParts';
import { UploadRow } from './UploadRow';
import { useUploadAnnouncements } from './useUploadAnnouncements';

interface YourUploadsProps {
  /** Files still on their way from this browser. */
  pending: PendingUpload[];
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/**
 * The signed-in person's own uploads that aren't finished: files still being sent from this
 * browser, then the server's queued, processing and failed ones. Nobody else sees these (see
 * canViewUpload). Each moves to Products once it's read, and the card goes when nothing is left.
 */
export function YourUploads({ pending, onRetry, onDismiss }: YourUploadsProps) {
  const list = useUploadList('mine');
  const now = useNow();
  const uploads = useMemo(() => list.data?.pages.flatMap((page) => page.uploads), [list.data]);
  const announcement = useUploadAnnouncements(uploads);
  const { isError, error, refetch, isRefetching } = list;
  const hasRows = pending.length > 0 || (uploads?.length ?? 0) > 0;

  return (
    <>
      {hasRows && (
        <Card aria-labelledby="your-uploads-heading" className="gap-0 py-0" role="region">
          <CardHeader className="border-b border-border/70 py-4">
            <CardTitle id="your-uploads-heading" className="text-base font-semibold">
              Your uploads
            </CardTitle>
            <CardAction className="flex items-center gap-1 self-center text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              Only you can see these
            </CardAction>
          </CardHeader>

          {isError && uploads && <StaleListBanner error={error} />}

          <ul>
            {pending.map((upload) => (
              <PendingUploadRow key={upload.localId} upload={upload} onRetry={onRetry} onDismiss={onDismiss} />
            ))}
            {uploads?.map((upload) => (
              <UploadRow key={upload.id} upload={upload} now={now} />
            ))}
          </ul>

          {list.hasNextPage && (
            <div className="border-t border-border/70 p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Nothing to show because the list couldn't load: say so, rather than seem to have nothing. */}
      {isError && !uploads && pending.length === 0 && (
        <InlineError title="Couldn't load your uploads" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
      )}

      {/* Outside the card, so a last upload finishing (and the card going) is still announced. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
