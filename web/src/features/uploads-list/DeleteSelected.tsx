import { useState } from 'react';
import { useDeleteUploads } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useCloseDetail, useOpenUploadId } from '@/features/upload-detail/useOpenUpload';
import { countOf } from '@/lib/format';
import { toastBatchResult } from '@/lib/toasts';

/**
 * Deletes the picked uploads (`ids`) together: a Delete button, there while any are picked, and the
 * dialog it opens, since deleting can't be undone. `noun` names them ("product", "upload"). The
 * server skips any the person may not delete, and the toast says so. If the open upload is among
 * those deleted, its panel closes.
 */
export function DeleteSelected({ ids, noun }: { ids: string[]; noun: string }) {
  // The uploads the dialog asks about, fixed as it opens: the list may change underneath it.
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const remove = useDeleteUploads();
  const openId = useOpenUploadId();
  const closeDetail = useCloseDetail();

  if (ids.length === 0 && confirming === null) return null;

  const confirm = () => {
    if (!confirming) return;
    remove.mutate(confirming, {
      onSuccess: (deleted) => {
        toastBatchResult(deleted.length, confirming.length, {
          noun,
          done: 'deleted',
          skipped: 'not deleted',
          why: 'Only whoever uploaded it, or an admin, can delete it.',
        });
        if (openId && deleted.includes(openId)) closeDetail();
        setConfirming(null);
      },
    });
  };

  return (
    <>
      {ids.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="border-danger-border bg-transparent text-danger hover:bg-danger-soft hover:text-danger"
          onClick={() => setConfirming(ids)}
        >
          Delete
        </Button>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={`Delete ${countOf(confirming?.length ?? 0, noun)}?`}
        description="Their files and extracted data are removed for good. The activity log keeps their history."
        confirmLabel="Delete"
        cancelLabel="Keep them"
        variant="destructive"
        request={remove}
        onConfirm={confirm}
        onClose={() => setConfirming(null)}
      />
    </>
  );
}
