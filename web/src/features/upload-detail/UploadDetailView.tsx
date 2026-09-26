import type { ReactNode, Ref } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { isActiveStatus, type FieldReview, type UploadDetail } from '@label-extractor/shared';
import { errorMessage, isNotFound } from '@/api/client';
import { useUploadDetail } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { RelativeTime } from '@/components/RelativeTime';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import { StatusPill } from '@/components/StatusPill';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { formatFileFacts } from '@/lib/format';
import { TONE_CLASSES, TONE_TEXT_CLASSES } from '@/lib/tone';
import { isInReview, progressLine, uploadState } from '@/lib/uploadState';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { DeleteUpload } from './DeleteUpload';
import { JsonDisclosure } from './JsonDisclosure';
import { ProductInformationCard } from './ProductInformationCard';
import { SourceDocumentCard } from './SourceDocumentCard';
import { StatusNotice } from './StatusNotice';
import { SubmitToProducts } from './SubmitToProducts';
import { UploadHistory } from './UploadHistory';

/** The detail's heading. UploadDetailPanel points its label here, so the panel is named after the file. */
export const DETAIL_TITLE_ID = 'upload-detail-title';

/** Every title takes these: focusable by script, so opening the panel can move focus there (see usePanelFocus). */
const titleProps = { id: DETAIL_TITLE_ID, tabIndex: -1 } as const;

/**
 * Everything about one upload, shown in UploadDetailPanel beside the list. `titleRef` goes on its
 * heading, whichever state it's in, so the panel can focus it.
 *
 * Until the first answer arrives it's a skeleton. An upload still being uploaded or read has its
 * real heading and says what's happening, and fills in when it's done (live updates refetch it).
 * If a later refresh fails, what was shown stays, with a note that it may be out of date; if it
 * failed because the upload has been deleted meanwhile, it says so and offers nothing to act on.
 */
export function UploadDetailView({ id, titleRef }: { id: string; titleRef?: Ref<HTMLHeadingElement> }) {
  const { data: upload, isPending, isError, error, refetch, isRefetching } = useUploadDetail(id);
  const deleted = isError && isNotFound(error);

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
        (deleted ? (
          <div className="grid gap-1">
            <h2 {...titleProps} ref={titleRef} className="text-2xl font-semibold outline-none">
              Upload not found
            </h2>
            <p className="text-muted-foreground">This upload doesn't exist. Check the link, or pick an upload from the list.</p>
          </div>
        ) : (
          <>
            <h2 {...titleProps} ref={titleRef} className="sr-only">
              Upload
            </h2>
            <InlineError title="Couldn't load this upload" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />
          </>
        ))}

      {/* Keyed by upload: everything inside that belongs to one upload (an open editor and its
          draft, the preview link) starts afresh for the next, even when it's already cached. */}
      {upload && (
        <Detail
          key={upload.id}
          upload={upload}
          titleRef={titleRef}
          readOnly={deleted}
          notice={
            deleted ? (
              <DeletedNotice />
            ) : (
              isError && (
                <StaleDataNotice what="this upload" error={error} onRetry={() => void refetch()} retrying={isRefetching} className="rounded-lg border" />
              )
            )
          }
        />
      )}
    </div>
  );
}

/** In place of the detail when it failed to render: the panel stays open, and can try again. */
export function DetailFailed({ onRetry, titleRef }: { onRetry: () => void; titleRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="grid min-w-0 gap-5">
      <h2 {...titleProps} ref={titleRef} className="sr-only">
        Upload
      </h2>
      {/* pr-10 keeps it clear of the panel's close button. */}
      <div className="pr-10">
        <InlineError
          title="Couldn't show this upload"
          message="Something went wrong on this page. Try again, or pick another upload from the list."
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}

interface DetailProps {
  upload: UploadDetail;
  titleRef?: Ref<HTMLHeadingElement>;
  /** Shown under the heading: why what's shown may not be current. */
  notice: ReactNode;
  /** Deleted meanwhile: shown as it was, with nothing to act on. */
  readOnly: boolean;
}

function Detail({ upload, titleRef, notice, readOnly }: DetailProps) {
  return (
    <>
      <DetailHeader upload={upload} titleRef={titleRef} />
      {notice}
      {isActiveStatus(upload.status) ? (
        <StillWorking upload={upload} />
      ) : (
        <>
          {!readOnly && <StatusNotice upload={upload} />}

          {/* Extracted data first, then the source document to check it against, then the raw JSON. */}
          {upload.result && <ProductInformationCard upload={{ ...upload, result: upload.result }} readOnly={readOnly} />}
          <SourceDocumentCard upload={upload} />
          {upload.result && <JsonDisclosure data={upload.result} fileName={upload.fileName} />}
          {!readOnly && <UploadHistory upload={upload} />}
          {/* Last, on its own row: it can't be undone, so it's out of the way of everything else. */}
          {upload.canDelete && !readOnly && <DeleteUpload upload={upload} />}
          {/* In Review: floats over the bottom of the panel, and ends up below Delete. */}
          {isInReview(upload) && !upload.resultUnreadable && !readOnly && <SubmitToProducts upload={upload} />}
        </>
      )}
    </>
  );
}

/**
 * The upload's name, status and facts. The same heading element whatever state the upload is in,
 * so focus on it stays put when a label finishes being read.
 */
function DetailHeader({ upload, titleRef }: { upload: UploadDetail; titleRef?: Ref<HTMLHeadingElement> }) {
  const now = useNow();
  // Like the list rows: the product leads once the label is read; until then, the file name.
  const productName = upload.result?.productName ?? null;
  const fileFacts = formatFileFacts(upload.mimeType, upload.sizeBytes);
  const lastReview = latestReview(upload.fieldReviews);

  return (
    <header className="grid gap-2">
      {/* pr-10 keeps the status clear of the panel's close button. */}
      <div className="flex items-start gap-3 pr-10">
        <h2 {...titleProps} ref={titleRef} className="min-w-0 text-2xl font-semibold break-words outline-none">
          {productName ?? upload.fileName}
        </h2>
        <StatusPill status={upload.status} confidence={upload.confidence} inReview={isInReview(upload)} className="mt-1.5 shrink-0" />
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
  );
}

/**
 * An upload still being uploaded or read (reached by a link, or run again while open): what's
 * happening to it, in the list row's words, until its details arrive.
 */
function StillWorking({ upload }: { upload: UploadDetail }) {
  const line = progressLine(uploadState(upload));
  return (
    <div role="status" className="flex items-start gap-2 text-sm">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
      <div className="grid gap-0.5">
        {line && <p className={cn('font-medium', TONE_TEXT_CLASSES[line.tone])}>{line.text}</p>}
        <p className="text-muted-foreground">Its details show here once the label is read.</p>
      </div>
    </div>
  );
}

/** The upload was deleted while it was open here (by someone else, or in another tab). */
function DeletedNotice() {
  return (
    <Alert className={TONE_CLASSES.warning}>
      <Trash2 />
      <AlertTitle className="font-semibold">This upload has been deleted</AlertTitle>
      <AlertDescription className="text-warning/90">It's shown as it was. Close this panel to go back to the list.</AlertDescription>
    </Alert>
  );
}

/** The most recent edit or check of any field, if there's been one. */
function latestReview(reviews: UploadDetail['fieldReviews']): FieldReview | null {
  return Object.values(reviews).reduce<FieldReview | null>((latest, review) => (!latest || review.at > latest.at ? review : latest), null);
}

/**
 * A label and its value. Deliberately no `min-w-0`: a fact can't shrink narrower than its content,
 * so it can never spill into the next one. The one exception is a `truncate` child (the file name):
 * it hides its overflow, so it can give way on its own.
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex gap-1.5 tabular-nums">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading upload" className="grid gap-3">
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-56 w-full rounded-xl" />
    </div>
  );
}
