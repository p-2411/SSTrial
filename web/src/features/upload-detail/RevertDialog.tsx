import { toast } from 'sonner';
import type { UploadDetail, UploadHistoryEntry } from '@label-extractor/shared';
import { errorMessage, isEditConflict } from '@/api/client';
import { useRevertUpload } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDateAndTime } from '@/lib/format';

interface RevertDialogProps {
  upload: Pick<UploadDetail, 'id' | 'revision'>;
  /** The point in the history to go back to; null when closed. */
  entry: UploadHistoryEntry | null;
  onClose: () => void;
}

/**
 * Admins only: asks before putting an upload's data back to a point in its history, since that
 * undoes later edits and checks. Made against the revision on screen, so it can't undo a change
 * the admin hasn't seen: if someone saved meanwhile, it's refused, and they can look again.
 */
export function RevertDialog({ upload, entry, onClose }: RevertDialogProps) {
  const revert = useRevertUpload(upload.id);

  const confirm = () => {
    if (!entry?.revertTo) return;
    revert.mutate(
      { revision: upload.revision, versionId: entry.revertTo },
      {
        onSuccess: () => {
          toast.success('Reverted');
          onClose();
        },
      },
    );
  };

  return (
    <ConfirmDialog
      open={entry !== null}
      title="Revert to this point?"
      description={
        <>
          The data goes back to how it was on {entry && formatDateAndTime(entry.occurredAt)}, and checks made since are undone. The
          revert is recorded in the history, so it can be undone too.
        </>
      }
      confirmLabel="Revert"
      cancelLabel="Keep it"
      request={revert}
      describeError={(error) =>
        isEditConflict(error) ? 'Someone changed this upload since you opened it. Close this and look again.' : errorMessage(error)
      }
      confirmDisabled={isEditConflict(revert.error)}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
