import type { ReactNode } from 'react';
import { formatBytes, type UploadDetail } from '@label-extractor/shared';
import { ApiRequestError, errorMessage } from '@/api/client';
import { useUploadDetail } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { StatusPill } from '@/components/StatusPill';
import { Skeleton } from '@/components/ui/skeleton';
import { fileTypeLabel, formatDateTime, formatRelativeTime } from '@/lib/format';
import { CoreInformationCard } from './ExtractionCards';
import { JsonDisclosure } from './JsonDisclosure';
import { SourceDocumentCard } from './SourceDocumentCard';
import { StatusNotice } from './StatusNotice';

/** The detail's heading. UploadDetailPanel points its label here, so the panel is named after the file. */
export const DETAIL_TITLE_ID = 'upload-detail-title';

/** Everything about one upload, shown in UploadDetailPanel beside the list. */
export function UploadDetailView({ id }: { id: string }) {
  const { data: upload, isPending, isError, error, refetch, isRefetching } = useUploadDetail(id);

  return (
    <div className="grid min-w-0 gap-5">
      {isPending && (
        <>
          <h2 id={DETAIL_TITLE_ID} className="sr-only">
            Loading upload
          </h2>
          <DetailSkeleton />
        </>
      )}

      {isError && !upload &&
        (error instanceof ApiRequestError && error.status === 404 ? (
          <div className="grid gap-1">
            <h2 id={DETAIL_TITLE_ID} className="text-2xl font-semibold">
              Upload not found
            </h2>
            <p className="text-muted-foreground">This upload doesn't exist. Check the link, or pick an upload from the list.</p>
          </div>
        ) : (
          <>
            <h2 id={DETAIL_TITLE_ID} className="sr-only">
              Upload
            </h2>
            <InlineError
              title="Couldn't load this upload"
              message={errorMessage(error)}
              onRetry={() => void refetch()}
              retrying={isRefetching}
            />
          </>
        ))}

      {upload && <Detail upload={upload} />}
    </div>
  );
}

function Detail({ upload }: { upload: UploadDetail }) {
  return (
    <>
      <header className="grid gap-2">
        {/* pr-10 keeps the status clear of the panel's close button. */}
        <div className="flex items-start gap-3 pr-10">
          <h2 id={DETAIL_TITLE_ID} className="min-w-0 text-2xl font-semibold break-words" title={upload.fileName}>
            {upload.fileName}
          </h2>
          <StatusPill status={upload.status} className="mt-1.5 shrink-0" />
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Fact label="Uploaded">
            <time dateTime={upload.createdAt} title={formatDateTime(upload.createdAt)}>
              {formatRelativeTime(upload.createdAt)}
            </time>
          </Fact>
          <Fact label="File">
            {fileTypeLabel(upload.mimeType)}, {formatBytes(upload.sizeBytes)}
          </Fact>
        </dl>
      </header>

      <StatusNotice upload={upload} />

      {/* Extracted data first, then the source document to check it against, then the raw JSON. */}
      {upload.result && <CoreInformationCard result={upload.result} />}
      {/* Keyed by id so switching uploads resets the remembered preview URL. */}
      <SourceDocumentCard key={upload.id} upload={upload} />
      {upload.result && <JsonDisclosure data={upload.result} fileName={upload.fileName} />}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-label="Loading upload" className="grid gap-3">
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-56 w-full rounded-xl" />
    </div>
  );
}
