import { useState } from 'react';
import { toast } from 'sonner';
import { canSubmitUpload, stillToCheck, type UploadSummary } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useCheckUploads, useSubmitUploads } from '@/api/queries';
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
import { productCount } from '@/lib/format';
import type { Selection } from '@/lib/useSelection';

/**
 * The Review tab's actions. An upload the model wasn't sure of ("Check (72%)", amber or red) must
 * have its flagged fields checked before it can go into Products: one by one in its detail, or all
 * at once with "Mark all as checked". "Submit all ready" then puts in every one with nothing left
 * to check; the server holds to the same rules. With some ticked (a row's box shows on hover), both
 * act on just those. "Select all" ticks every one listed.
 */
export function ReviewActions({ uploads, selection }: { uploads: UploadSummary[]; selection: Selection }) {
  const submit = useSubmitUploads();
  // The uploads the dialog asks about, fixed as it opens: the list may change underneath it.
  const [confirmingCheck, setConfirmingCheck] = useState<UploadSummary[] | null>(null);
  const picked = selection.selected.length > 0;
  // What the buttons act on: the ticked ones, or with none ticked, every one listed.
  const actOn = picked ? uploads.filter((upload) => selection.isSelected(upload.id)) : uploads;
  const ready = actOn.filter(canSubmitUpload);
  const toCheck = actOn.filter(stillToCheck);

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

  return (
    <div className="flex items-center gap-2">
      {/* A tertiary action: plain text, underlined on hover. */}
      <Button variant="link" size="sm" className="px-1 font-medium" onClick={() => selection.setAll(!selection.allSelected)}>
        {selection.allSelected ? 'Deselect all' : 'Select all'}
      </Button>
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
      <CheckAllDialog uploads={confirmingCheck} onClose={() => setConfirmingCheck(null)} />
    </div>
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
