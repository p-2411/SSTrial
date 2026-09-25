import { Inbox } from 'lucide-react';
import { errorMessage } from '@/api/client';
import { useUploadList } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/lib/useNow';
import { PendingUploadRow } from '@/features/upload/PendingUploadRow';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { ExportMenu } from './ExportMenu';
import { rowClassName, UploadRow } from './UploadRow';
import { useStatusFilter } from './statusFilters';
import { useStatusAnnouncements } from './useStatusAnnouncements';

interface UploadListProps {
  /** Files still being sent from this browser; shown above the server's list. */
  pending: PendingUpload[];
  onRetryPending: (upload: PendingUpload) => void;
  onDismissPending: (localId: string) => void;
}

export function UploadList({ pending, onRetryPending, onDismissPending }: UploadListProps) {
  const { data: uploads, isPending, isError, error, refetch, isRefetching } = useUploadList();
  const filter = useStatusFilter();
  const now = useNow();
  const announcement = useStatusAnnouncements(uploads);

  const visible = uploads?.filter((upload) => filter.matches(upload.status));
  const inProgress = uploads?.filter((u) => u.status === 'queued' || u.status === 'processing').length ?? 0;
  const hasRows = pending.length > 0 || (visible !== undefined && visible.length > 0);
  const hasCompleted = uploads?.some((u) => u.status === 'completed') ?? false;

  return (
    <Card aria-labelledby="uploads-heading" className="gap-0 py-0" role="region">
      <CardHeader className="border-b border-border/70 py-4">
        <CardTitle id="uploads-heading" className="text-base font-semibold">
          {filter.label}
        </CardTitle>
        {uploads && uploads.length > 0 && (
          <CardDescription className="tabular-nums">
            {uploads.length} {uploads.length === 1 ? 'file' : 'files'}
            {inProgress > 0 && `, ${inProgress} in progress`}
          </CardDescription>
        )}
        {/* Only offered once there's extracted data to export. */}
        {hasCompleted && (
          <CardAction>
            <ExportMenu />
          </CardAction>
        )}
      </CardHeader>

      {/* Refresh failed but we still have data: keep showing it, and say it may be out of date. */}
      {isError && uploads && (
        <p role="status" className="border-b border-warning-border bg-warning-soft px-4 py-2 text-sm text-warning">
          Couldn't refresh the list, so statuses may be out of date. {errorMessage(error)}
        </p>
      )}

      {hasRows && (
        <ul>
          {pending.map((upload) => (
            <PendingUploadRow key={upload.localId} upload={upload} onRetry={onRetryPending} onDismiss={onDismissPending} />
          ))}
          {visible?.map((upload) => <UploadRow key={upload.id} upload={upload} now={now} />)}
        </ul>
      )}

      {isPending && <ListSkeleton />}

      {isError && !uploads && (
        <div className="p-4">
          <InlineError
            title="Couldn't load your uploads"
            message={errorMessage(error)}
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        </div>
      )}

      {!hasRows && uploads && (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
            <Inbox className="size-5" aria-hidden />
          </span>
          <p className="font-semibold">{filter.emptyText}</p>
          {uploads.length === 0 && (
            <p className="max-w-sm text-sm text-muted-foreground">
              Add a label photo or PDF above. Each file is read in the background, and its product name, brand,
              ingredients, allergens and net weight appear here.
            </p>
          )}
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <ul aria-label="Loading uploads">
      {[0, 1, 2].map((i) => (
        <li key={i} className={rowClassName}>
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
