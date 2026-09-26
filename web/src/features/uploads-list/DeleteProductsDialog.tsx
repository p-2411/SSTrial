import { useMatch } from 'react-router';
import { toast } from 'sonner';
import { useDeleteUploads } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useCloseDetail } from '@/features/upload-detail/UploadDetailPanel';
import { productCount } from '@/lib/format';
import { UPLOAD_PATH_PATTERN } from '@/routes';

/**
 * Asks before deleting the picked products (`ids`; null when closed), which can't be undone. The
 * server skips any the person may not delete, and the toast says so. If the open product is among
 * those deleted, its panel closes.
 */
export function DeleteProductsDialog({ ids, onClose }: { ids: string[] | null; onClose: () => void }) {
  const remove = useDeleteUploads();
  const openId = useMatch(UPLOAD_PATH_PATTERN)?.params.id;
  const closeDetail = useCloseDetail();

  const confirm = () => {
    if (!ids) return;
    remove.mutate(ids, {
      onSuccess: (deleted) => {
        if (deleted.length > 0) toast.success(`${productCount(deleted.length)} deleted`);
        const skipped = ids.length - deleted.length;
        if (skipped > 0) {
          toast.warning(`${productCount(skipped)} not deleted`, { description: 'Only whoever uploaded a product, or an admin, can delete it.' });
        }
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
