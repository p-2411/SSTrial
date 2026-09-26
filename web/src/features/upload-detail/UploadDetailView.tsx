import type { ReactNode } from 'react';
import { isActiveStatus, type FieldReview, type UploadDetail } from '@label-extractor/shared';
import { ApiRequestError, errorMessage } from '@/api/client';
import { useUploadDetail } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { RelativeTime } from '@/components/RelativeTime';
import { StatusPill } from '@/components/StatusPill';
import { Skeleton } from '@/components/ui/skeleton';
import { formatFileFacts } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { ProductInformationCard } from './ProductInformationCard';
import { DeleteUpload } from './DeleteUpload';
import { JsonDisclosure } from './JsonDisclosure';
import { SourceDocumentCard } from './SourceDocumentCard';
import { StatusNotice } from './StatusNotice';
import { UploadHistory } from './UploadHistory';

/** The detail's heading. UploadDetailPanel points its label here, so the panel is named after the file. */
export const DETAIL_TITLE_ID = 'upload-detail-title';

/** Everything about one upload, shown in UploadDetailPanel beside the list. */
export function UploadDetailView({ id }: { id: string }) {
  const { data: upload, isPending, isError, error, refetch, isRefetching } = useUploadDetail(id);
  // Still being read (reached by a link, or re-queued by a retry while open): there's nothing to show
  // yet, so it loads until it's done. Live updates refetch it the moment it finishes.
  const stillWorking = upload !== undefined && isActiveStatus(upload.status);

  return (
    <div className="grid min-w-0 gap-5">
      {(isPending || stillWorking) && (
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

      {/* Keyed by upload: everything inside that belongs to one upload (an open editor and its
          draft, the preview link) starts afresh for the next, even when it's already cached. */}
      {upload && !stillWorking && <Detail key={upload.id} upload={upload} />}
    </div>
  );
}

function Detail({ upload }: { upload: UploadDetail }) {
  const now = useNow();
  // Like the list rows: the product leads once the label is read; until then, the file name.
  const productName = upload.result?.productName ?? null;
  const fileFacts = formatFileFacts(upload.mimeType, upload.sizeBytes);
  const lastReview = latestReview(upload.fieldReviews);

  return (
    <>
      <header className="grid gap-2">
        {/* pr-10 keeps the status clear of the panel's close button. */}
        <div className="flex items-start gap-3 pr-10">
          <h2 id={DETAIL_TITLE_ID} className="min-w-0 text-2xl font-semibold break-words">
            {productName ?? upload.fileName}
          </h2>
          <StatusPill status={upload.status} confidence={upload.confidence} className="mt-1.5 shrink-0" />
        </div>
        {/* The facts, wrapping onto another line rather than overlapping: no fact shrinks below
            what it must show. Only a long file name gives way, truncated (full name in its tooltip). */}
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Fact label="File">
            {/* The file name only when the heading isn't already showing it. */}
            {productName ? (
              <>
                <span className="truncate" title={upload.fileName}>
                  {upload.fileName}
                </span>
                <span className="shrink-0 text-muted-foreground">{fileFacts}</span>
              </>
            ) : (
              fileFacts
            )}
          </Fact>
          <Fact label="Uploaded">
            <RelativeTime iso={upload.createdAt} now={now} />
            {upload.uploadedBy && <span className="text-muted-foreground"> by {upload.uploadedBy}</span>}
          </Fact>
          {/* One line for the whole card, rather than a "by … at …" under every field. */}
          {lastReview && (
            <Fact label={lastReview.kind === 'edited' ? 'Last edited' : 'Last checked'}>
              <RelativeTime iso={lastReview.at} now={now} />
              <span className="text-muted-foreground"> by {lastReview.by ?? 'a former member'}</span>
            </Fact>
          )}
        </dl>
      </header>

      <StatusNotice upload={upload} />

      {/* Extracted data first, then the source document to check it against, then the raw JSON. */}
      {upload.result && <ProductInformationCard upload={{ ...upload, result: upload.result }} />}
      <SourceDocumentCard upload={upload} />
      {upload.result && <JsonDisclosure data={upload.result} fileName={upload.fileName} />}
      <UploadHistory upload={upload} />
      {/* Last, on its own row: it can't be undone, so it's out of the way of everything else. */}
      {upload.canDelete && <DeleteUpload upload={upload} />}
    </>
  );
}

/**
 * A label and its value. Deliberately no `min-w-0`: a fact can't shrink narrower than its content,
 * so it can never spill into the next one. The one exception is a `truncate` child (the file name):
 * it hides its overflow, so it can give way on its own.
 */
/** The most recent edit or check of any field, if there's been one. */
function latestReview(reviews: UploadDetail['fieldReviews']): FieldReview | null {
  return Object.values(reviews).reduce<FieldReview | null>((latest, review) => (!latest || review.at > latest.at ? review : latest), null);
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-1.5', className)}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex gap-1.5 tabular-nums">{children}</dd>
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
