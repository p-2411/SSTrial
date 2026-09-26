import { useDeleteUploads } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCloseDetail, useOpenUploadId } from '@/features/upload-detail/useOpenUpload';
import { countOf } from '@/lib/format';
import { toastBatchResult } from '@/lib/toasts';

/** What deleting is called where it's offered: "Delete", or "Dismiss" for failures. */
type DeleteVerb = 'Delete' | 'Dismiss';

const DONE: Record<DeleteVerb, string> = { Delete: 'deleted', Dismiss: 'dismissed' };

interface DeleteUploadsDialogProps {
  /** The uploads it asks about, fixed when it opened (the list may change underneath it); null when closed. */
  ids: string[] | null;
  /**
   * One of them, where the action alone doesn't say what goes: "Dismiss 2 failed uploads?". Left out,
   * it's whatever is ticked: "Delete 3 selected?".
   */
  noun?: string;
  verb: DeleteVerb;
  /** What deleting them means, since it can't be undone. */
  description: string;
  /** Why the server might have skipped some, for the toast that says so. */
  skippedWhy: string;
  /** Once the server has answered. */
  onDeleted?: () => void;
  onClose: () => void;
}

/**
 * Asks before deleting several uploads, then deletes them together and says how it went: how many
 * went, and how many the server skipped and why. If the open upload is among those deleted, its
 * panel closes. Products, Review and Uploading's failures all delete through it.
 */
export function DeleteUploadsDialog({ ids, noun, verb, description, skippedWhy, onDeleted, onClose }: DeleteUploadsDialogProps) {
  const remove = useDeleteUploads();
  const openId = useOpenUploadId();
  const closeDetail = useCloseDetail();

  const confirm = () => {
    if (!ids) return;
    remove.mutate(ids, {
      onSuccess: (deleted) => {
        toastBatchResult(deleted.length, ids.length, { noun, done: DONE[verb], skipped: `not ${DONE[verb]}`, why: skippedWhy });
        if (openId && deleted.includes(openId)) closeDetail();
        onDeleted?.();
        onClose();
      },
    });
  };

  return (
    <ConfirmDialog
      open={ids !== null}
      title={`${verb} ${noun ? countOf(ids?.length ?? 0, noun) : `${ids?.length ?? 0} selected`}?`}
      description={description}
      confirmLabel={verb}
      cancelLabel="Keep them"
      variant="destructive"
      request={remove}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
