import { useMemo, useState, type ReactNode } from 'react';
import type { UploadSummary } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useUploadList } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { SegmentedTabsList, SegmentedTabsTrigger } from '@/components/SegmentedTabs';
import { StaleDataNotice } from '@/components/StaleDataNotice';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { PendingUploadRow } from '@/features/upload/PendingUploadRow';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { useNow } from '@/lib/useNow';
import { useSelection, type Selection } from '@/lib/useSelection';
import { ListSkeleton } from './listParts';
import { ReviewActions } from './ReviewActions';
import { UploadRow } from './UploadRow';
import { useUploadAnnouncements } from './useUploadAnnouncements';

type Tab = 'uploading' | 'review';

interface YourUploadsProps {
  /** Files still on their way from this browser. */
  pending: PendingUpload[];
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/**
 * The person's own uploads on their way to Products, in one card with a tab for each stage.
 * Uploading: files still being sent from this browser, then the server's queued, processing and
 * failed ones. Review: the read ones, waiting to be checked and submitted (see ReviewActions).
 * A tab is only there while it has something in it (or its list couldn't load, to say so), and the
 * card only while it has a tab. Until both lists have first loaded, the card holds their place
 * with a skeleton, so the page below doesn't jump when they arrive; it goes if both are empty.
 * Nobody else sees these (see canViewUpload).
 */
export function YourUploads({ pending, onRetry, onDismiss }: YourUploadsProps) {
  const uploadingList = useUploadList('upload');
  const reviewList = useUploadList('review');
  const now = useNow();
  const uploading = uploadingList.data;
  const review = reviewList.data;
  const reviewIds = useMemo(() => review?.map((upload) => upload.id) ?? [], [review]);
  const selection = useSelection(reviewIds);
  const announcement = useUploadAnnouncements(uploading);
  const counts = { uploading: pending.length + (uploading?.length ?? 0), review: review?.length ?? 0 };
  const shown: Record<Tab, boolean> = {
    uploading: counts.uploading > 0 || (uploadingList.isError && !uploading),
    review: counts.review > 0 || (reviewList.isError && !review),
  };
  const [tab, setTab] = useActiveTab(shown, pending.length);
  const loading = !shown.uploading && !shown.review && (uploadingList.isPending || reviewList.isPending);

  return (
    <>
      {loading && <YourUploadsSkeleton />}
      {(shown.uploading || shown.review) && (
        <Card aria-label="Your uploads" className="gap-0 py-0" role="region">
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-0">
            <div className="flex min-h-15 items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
              <SegmentedTabsList>
                {shown.uploading && (
                  <SegmentedTabsTrigger value="uploading">
                    Uploading <Count n={counts.uploading} />
                  </SegmentedTabsTrigger>
                )}
                {shown.review && (
                  <SegmentedTabsTrigger value="review">
                    Review <Count n={counts.review} />
                  </SegmentedTabsTrigger>
                )}
              </SegmentedTabsList>
              {tab === 'review' && review && review.length > 0 && <ReviewActions uploads={review} selection={selection} />}
            </div>

            <TabsContent value="uploading">
              <ListState list={uploadingList} rows={uploading}>
                <ul aria-label="Uploading">
                  {pending.map((upload) => (
                    <PendingUploadRow key={upload.localId} upload={upload} onRetry={onRetry} onDismiss={onDismiss} />
                  ))}
                  {uploading?.map((upload) => (
                    <UploadRow key={upload.id} upload={upload} now={now} />
                  ))}
                </ul>
              </ListState>
            </TabsContent>

            <TabsContent value="review">
              <ListState list={reviewList} rows={review}>
                <ReviewList uploads={review ?? []} selection={selection} now={now} />
              </ListState>
            </TabsContent>
          </Tabs>
        </Card>
      )}

      {/* Outside the card, so an upload that finishes as the card goes is still announced. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/** The card as it will be, tabs and rows, while its lists first load. */
function YourUploadsSkeleton() {
  return (
    <Card aria-label="Your uploads" className="gap-0 py-0" role="region">
      <div className="flex min-h-15 items-center border-b border-border/70 px-4 py-3">
        <Skeleton className="h-9 w-48 rounded-lg" />
      </div>
      <ListSkeleton label="Loading your uploads" />
    </Card>
  );
}

function ReviewList({ uploads, selection, now }: { uploads: UploadSummary[]; selection: Selection; now: number }) {
  return (
    <ul aria-label="Review">
      {uploads.map((upload) => (
        <UploadRow key={upload.id} upload={upload} now={now} selected={selection.isSelected(upload.id)} onSelect={selection.toggle} />
      ))}
    </ul>
  );
}

/**
 * Which tab is showing: the person's choice while that tab is there; otherwise Uploading if it's
 * there, else Review. So when the last upload is read, Review takes over, and when the last is
 * submitted, Uploading does. New files on their way bring Uploading to the front, so their
 * progress shows.
 */
function useActiveTab(shown: Record<Tab, boolean>, sending: number): [Tab, (tab: Tab) => void] {
  const [chosen, setChosen] = useState<Tab | null>(null);
  const [sentBefore, setSentBefore] = useState(sending);
  if (sending !== sentBefore) {
    setSentBefore(sending);
    if (sending > sentBefore) setChosen('uploading');
  }
  // A choice lasts as long as its tab: coming back later, it doesn't take over again.
  if (chosen && !shown[chosen]) setChosen(null);
  return [chosen && shown[chosen] ? chosen : shown.uploading ? 'uploading' : 'review', setChosen];
}

function Count({ n }: { n: number }) {
  return <span className="text-muted-foreground tabular-nums">{n}</span>;
}

/**
 * A tab's list with what goes around it: a warning when a refresh failed but rows are still shown,
 * the error when it couldn't load at all, and "Load more" (which says if the next page failed).
 */
function ListState({ list, rows, children }: { list: ReturnType<typeof useUploadList>; rows: UploadSummary[] | undefined; children: ReactNode }) {
  if (list.isError && !rows) {
    return (
      <div className="p-4">
        <InlineError title="Couldn't load your uploads" message={errorMessage(list.error)} onRetry={() => void list.refetch()} retrying={list.isRefetching} />
      </div>
    );
  }
  return (
    <>
      {list.isRefetchError && <StaleDataNotice what="your uploads" error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} />}
      {children}
      <LoadMoreButton query={list} className="border-t border-border/70 p-3" />
    </>
  );
}
