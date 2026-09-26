import { useState } from 'react';
import type { UploadSummary } from '@label-extractor/shared';
import { useDeleteUploads } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import type { PendingUpload } from '@/features/upload/useFileUploads';
import { countOf } from '@/lib/format';
import { toastBatchResult } from '@/lib/toasts';
import type { Selection } from '@/lib/useSelection';

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
  const remove = useDeleteUploads();
  const picked = selection.selected.length > 0;

  const dismissUnsent = () => unsent.forEach((upload) => onDismiss(upload.localId));

  const dismiss = () => {
    const ids = picked ? selection.selected : failed.map((upload) => upload.id);
    // Only files that never reached the server: nothing to lose, so nothing to confirm.
    if (ids.length === 0) dismissUnsent();
    else setConfirming({ ids, withUnsent: !picked });
  };

  const confirm = () => {
    if (!confirming) return;
    remove.mutate(confirming.ids, {
      onSuccess: (deleted) => {
        if (confirming.withUnsent) dismissUnsent();
        toastBatchResult(deleted.length, confirming.ids.length, {
          noun: 'failed upload',
          done: 'dismissed',
          skipped: 'not dismissed',
          why: 'They changed meanwhile. Look at them again.',
        });
        selection.clear();
        setConfirming(null);
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {failed.length > 0 && (
        // A tertiary action: plain text, underlined on hover (like Review's).
        <Button variant="link" size="sm" className="px-1 font-medium" onClick={() => selection.setAll(!selection.allSelected)}>
          {selection.allSelected ? 'Deselect all' : 'Select all'}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={dismiss}>
        {picked ? `Dismiss ${selection.selected.length}` : 'Dismiss all failed'}
      </Button>
      <ConfirmDialog
        open={confirming !== null}
        title={`Dismiss ${countOf(confirming?.ids.length ?? 0, 'failed upload')}?`}
        description="They're deleted with their files, so they can't be tried again. The activity log keeps their history."
        confirmLabel="Dismiss"
        cancelLabel="Keep them"
        variant="destructive"
        request={remove}
        onConfirm={confirm}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}
