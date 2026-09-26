import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { canSubmitUpload, stillToCheck, type UploadSummary } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useCheckUploads, useSubmitUploads, useUploadList } from '@/api/queries';
import { InlineError } from '@/components/InlineError';
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
import { Checkbox } from '@/components/ui/checkbox';
import { productCount } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useSelection } from '@/lib/useSelection';
import { StaleListBanner } from './listParts';
import { UploadRow } from './UploadRow';

/**
 * The second stage, Review: the person's own uploads that have been read, waiting to go into
 * Products. One the model wasn't sure of ("Check (72%)", amber or red) must have its flagged fields
 * checked first: one by one in its detail, or all at once with "Mark all as checked". "Submit all
 * ready" then puts in every one with nothing left to check. The server holds to the same rules.
 * With some ticked, both act on just those. Only the uploader sees these, and the card goes when
 * nothing is waiting.
 */
export function ReviewStage() {
  const list = useUploadList('review');
  const now = useNow();
  const uploads = useMemo(() => list.data?.pages.flatMap((page) => page.uploads), [list.data]);
  const ids = useMemo(() => uploads?.map((upload) => upload.id) ?? [], [uploads]);
  const selection = useSelection(ids);
  // What the buttons act on: the ticked ones, or with none ticked, every one listed.
  const picked = selection.selected.length > 0;
  const actOn = (picked ? uploads?.filter((upload) => selection.isSelected(upload.id)) : uploads) ?? [];
  const ready = actOn.filter(canSubmitUpload);
  const toCheck = actOn.filter(stillToCheck);
  const submit = useSubmitUploads();
  // The uploads the dialog asks about, fixed as it opens: the list may change underneath it.
  const [confirmingCheck, setConfirmingCheck] = useState<UploadSummary[] | null>(null);
  const { isError, error, refetch, isRefetching } = list;

  const submitReady = () => {
    const ids = ready.map((upload) => upload.id);
    submit.mutate(ids, {
      onSuccess: (submitted) => {
        selection.clear();
        if (submitted.length > 0) toast.success(`${productCount(submitted.length)} added to Products`);
        const left = ids.length - submitted.length;
        if (left > 0) {
          toast.warning(`${productCount(left)} weren't submitted`, { description: 'They changed since you looked. Check them again.' });
        }
      },
      onError: (failure) => toast.error("Couldn't submit", { description: errorMessage(failure) }),
    });
  };

  if (isError && !uploads) {
    return <InlineError title="Couldn't load your uploads to review" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isRefetching} />;
  }
  if (!uploads || uploads.length === 0) return null;

  return (
    <Card aria-labelledby="review-heading" className="gap-0 py-0" role="region">
      <CardHeader className="border-b border-border/70 py-4">
        <div className="flex h-8 items-center gap-3">
          <Checkbox checked={selection.all} onCheckedChange={(checked) => selection.setAll(checked === true)} aria-label="Select all to review" />
          <CardTitle id="review-heading" className="text-base font-semibold">
            Review
          </CardTitle>
          {picked && <span className="text-sm text-muted-foreground">{selection.selected.length} selected</span>}
        </div>
        <CardAction className="flex items-center gap-2">
          {toCheck.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setConfirmingCheck(toCheck)}>
              {picked ? `Mark ${toCheck.length} as checked` : 'Mark all as checked'}
            </Button>
          )}
          <Button
            size="sm"
            disabled={ready.length === 0}
            loading={submit.isPending}
            title={ready.length === 0 ? 'Check the flagged products first' : undefined}
            onClick={submitReady}
          >
            {picked ? `Submit ${ready.length} ready` : `Submit all ready${ready.length > 0 ? ` (${ready.length})` : ''}`}
          </Button>
        </CardAction>
      </CardHeader>

      {isError && <StaleListBanner error={error} />}

      <ul>
        {uploads.map((upload) => (
          <UploadRow key={upload.id} upload={upload} now={now} selected={selection.isSelected(upload.id)} onSelect={selection.toggle} />
        ))}
      </ul>

      {list.hasNextPage && (
        <div className="border-t border-border/70 p-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}

      <CheckAllDialog uploads={confirmingCheck} onClose={() => setConfirmingCheck(null)} />
    </Card>
  );
}

/**
 * Asks before marking every flagged field as checked: it's the person vouching for fields the model
 * wasn't sure of. Stays open until it's done, or says why it couldn't be.
 */
function CheckAllDialog({ uploads, onClose }: { uploads: UploadSummary[] | null; onClose: () => void }) {
  const check = useCheckUploads();
  const count = uploads?.length ?? 0;

  const confirm = () => {
    if (!uploads) return;
    check.mutate(
      uploads.map((upload) => upload.id),
      {
        onSuccess: (checked) => {
          toast.success(`${productCount(checked.length)} marked as checked`);
          onClose();
        },
      },
    );
  };
  const onOpenChange = (open: boolean) => {
    if (open || check.isPending) return; // no walking away mid-save
    check.reset();
    onClose();
  };

  return (
    <AlertDialog open={uploads !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark {productCount(count)} as checked?</AlertDialogTitle>
          <AlertDialogDescription>Their flagged fields are marked as checked by you, and can then be submitted.</AlertDialogDescription>
        </AlertDialogHeader>
        {check.isError && (
          <p role="alert" className="text-danger">
            {errorMessage(check.error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={check.isPending}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button loading={check.isPending} onClick={confirm}>
            Mark as checked
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
