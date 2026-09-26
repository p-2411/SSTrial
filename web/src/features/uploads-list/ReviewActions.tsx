import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { canSubmitUpload, stillToCheck, type UploadSummary } from '@label-extractor/shared';
import { useCheckUploads } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSubmitToProducts } from '@/features/upload-detail/useSubmitToProducts';
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
  const { submitToProducts, submitting } = useSubmitToProducts();
  // The uploads the dialog asks about, fixed as it opens: the list may change underneath it.
  const [confirmingCheck, setConfirmingCheck] = useState<UploadSummary[] | null>(null);
  const picked = selection.selected.length > 0;
  // What the buttons act on: the ticked ones, or with none ticked, every one listed.
  const actOn = picked ? uploads.filter((upload) => selection.isSelected(upload.id)) : uploads;
  const ready = actOn.filter(canSubmitUpload);
  const toCheck = actOn.filter(stillToCheck);

  const submitReady = () =>
    submitToProducts(
      ready.map((upload) => upload.id),
      () => selection.clear(),
    );

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
      <WhyDisabled reason={ready.length === 0 ? 'Check the flagged products first' : null}>
        {(describedBy) => (
          <Button size="sm" disabled={ready.length === 0} loading={submitting} aria-describedby={describedBy} onClick={submitReady}>
            {picked ? `Submit ${ready.length} ready` : `Submit all ready${ready.length > 0 ? ` (${ready.length})` : ''}`}
          </Button>
        )}
      </WhyDisabled>
      <CheckAllDialog uploads={confirmingCheck} onClose={() => setConfirmingCheck(null)} />
    </div>
  );
}

/**
 * Why a button is disabled, when it is (`reason`): in a tooltip on hover or focus, and read out with
 * the button. A disabled button takes neither, so the tooltip hangs on a wrapper around it.
 */
function WhyDisabled({ reason, children }: { reason: string | null; children: (describedBy: string | undefined) => ReactNode }) {
  const id = useId();
  if (!reason) return children(undefined);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {children(id)}
          <span id={id} className="sr-only">
            {reason}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Asks before marking every flagged field as checked: it's the person vouching for fields the model
 * wasn't sure of.
 */
function CheckAllDialog({ uploads, onClose }: { uploads: UploadSummary[] | null; onClose: () => void }) {
  const check = useCheckUploads();

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

  return (
    <ConfirmDialog
      open={uploads !== null}
      title={`Mark ${productCount(uploads?.length ?? 0)} as checked?`}
      description="Their flagged fields are marked as checked by you, and can then be submitted."
      confirmLabel="Mark as checked"
      request={check}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
