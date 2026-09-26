import { useMemo } from 'react';
import { errorMessage } from '@/api/client';
import { useUploadList } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dropzone } from '@/features/upload/Dropzone';
import { PendingUploadRow } from '@/features/upload/PendingUploadRow';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { useNow } from '@/lib/useNow';
import { StaleListBanner } from './listParts';
import { UploadRow } from './UploadRow';
import { useUploadAnnouncements } from './useUploadAnnouncements';

interface UploadStageProps {
  /** Files still on their way from this browser. */
  pending: PendingUpload[];
  onUpload: (files: File[]) => void;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/**
 * The first stage, Upload: where files come in (the drop area), and where they stay while they're
 * sent and read: files still on their way from this browser, then the server's queued, processing
 * and failed ones. Only the uploader sees these (see canViewUpload). Each moves on to Review once
 * it's been read.
 */
export function UploadStage({ pending, onUpload, onRetry, onDismiss }: UploadStageProps) {
  const list = useUploadList('upload');
  const now = useNow();
  const uploads = useMemo(() => list.data?.pages.flatMap((page) => page.uploads), [list.data]);
  const announcement = useUploadAnnouncements(uploads);
  const { isError, error, refetch, isRefetching } = list;
  const hasRows = pending.length > 0 || (uploads?.length ?? 0) > 0;

  return (
    <Card aria-labelledby="upload-heading" className="gap-0 py-0" role="region">
      <CardHeader className="py-4">
        <CardTitle id="upload-heading" className="text-base font-semibold">
          Upload
        </CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        <Dropzone onUpload={onUpload} />
      </div>

      {isError && uploads && <StaleListBanner error={error} />}

      {hasRows && (
        <ul aria-label="Uploading" className="border-t border-border/70">
          {pending.map((upload) => (
            <PendingUploadRow key={upload.localId} upload={upload} onRetry={onRetry} onDismiss={onDismiss} />
          ))}
          {uploads?.map((upload) => (
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

      {/* Nothing to show because the list couldn't load: say so, rather than seem to have nothing. */}
      {isError && !uploads && (
        <div className="border-t border-border/70 p-4">
          <InlineError title="Couldn't load your uploads" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
}
