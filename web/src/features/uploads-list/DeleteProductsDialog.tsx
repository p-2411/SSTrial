import { useDeleteUploads } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCloseDetail, useOpenUploadId } from '@/features/upload-detail/useOpenUpload';
import { productCount } from '@/lib/format';
import { toastBatchResult } from '@/lib/toasts';

/**
 * Asks before deleting the picked products (`ids`; null when closed), which can't be undone. The
 * server skips any the person may not delete, and the toast says so. If the open product is among
 * those deleted, its panel closes.
 */
export function DeleteProductsDialog({ ids, onClose }: { ids: string[] | null; onClose: () => void }) {
  const remove = useDeleteUploads();
  const openId = useOpenUploadId();
  const closeDetail = useCloseDetail();

  const confirm = () => {
    if (!ids) return;
    remove.mutate(ids, {
      onSuccess: (deleted) => {
        toastBatchResult(deleted.length, ids.length, {
          done: 'deleted',
          skipped: 'not deleted',
          why: 'Only whoever uploaded a product, or an admin, can delete it.',
        });
        if (openId && deleted.includes(openId)) closeDetail();
        onClose();
      },
    });
  };

  return (
    <ConfirmDialog
      open={ids !== null}
      title={`Delete ${productCount(ids?.length ?? 0)}?`}
      description="Their files and extracted data are removed for good. The activity log keeps their history."
      confirmLabel="Delete"
      cancelLabel="Keep them"
      variant="destructive"
      request={remove}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
