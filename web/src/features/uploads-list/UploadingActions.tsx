import { useState } from 'react';
import type { UploadSummary } from '@label-extractor/shared';
import { Button } from '@/components/ui/button';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import type { Selection } from '@/lib/useSelection';
import { DeleteUploadsDialog } from './DeleteUploadsDialog';
import { SelectAllButton } from './SelectAllButton';

interface UploadingActionsProps {
  /** Uploads the server couldn't read. */
  failed: UploadSummary[];
  /** Files this browser couldn't send (see couldNotSend). */
  unsent: PendingUpload[];
  /** Which of `failed` are ticked. */
  selection: Selection;
  onDismiss: (localId: string) => void;
}

/**
 * The Uploading tab's actions, while anything in it has failed. "Dismiss all failed" clears every
 * failure: files this browser couldn't send are just dismissed, and uploads the server couldn't
 * read are deleted, files and all, once the person confirms (they can't be tried again after).
 * With some ticked (a failed row's box shows on hover), it dismisses just those. "Select all" ticks
 * every failed upload.
 */
export function UploadingActions({ failed, unsent, selection, onDismiss }: UploadingActionsProps) {
  // What the dialog asks about, fixed as it opens: the list may change underneath it.
  const [confirming, setConfirming] = useState<{ ids: string[]; withUnsent: boolean } | null>(null);
  const picked = selection.selected.length > 0;

  const dismissUnsent = () => unsent.forEach((upload) => onDismiss(upload.localId));

  const dismiss = () => {
    const ids = picked ? selection.selected : failed.map((upload) => upload.id);
    // Only files that never reached the server: nothing to lose, so nothing to confirm.
    if (ids.length === 0) dismissUnsent();
    else setConfirming({ ids, withUnsent: !picked });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {failed.length > 0 && <SelectAllButton selection={selection} />}
      <Button variant="outline" size="sm" onClick={dismiss}>
        {picked ? `Dismiss ${selection.selected.length}` : 'Dismiss all failed'}
      </Button>
      <DeleteUploadsDialog
        ids={confirming?.ids ?? null}
        noun="failed upload"
        verb="Dismiss"
        description="They're deleted with their files, so they can't be tried again. The activity log keeps their history."
        skippedWhy="They changed meanwhile. Look at them again."
        onDeleted={() => confirming?.withUnsent && dismissUnsent()}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
