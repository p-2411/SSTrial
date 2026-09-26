import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { UploadDetail } from '@label-extractor/shared';
import { useDeleteUpload } from '@/api/queries';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useCloseDetail } from './UploadDetailPanel';

/**
 * Deleting the product, its file with it (or, for an upload that was never read, just the file),
 * offered to whoever may (its uploader or an admin: the server says, as `canDelete`). It can't be
 * undone, so it asks first (see ConfirmDialog). Then the panel closes.
 */
export function DeleteUpload({ upload }: { upload: Pick<UploadDetail, 'id' | 'fileName' | 'result'> }) {
  const remove = useDeleteUpload();
  const close = useCloseDetail();
  const [open, setOpen] = useState(false);
  const name = upload.result?.productName ?? upload.fileName;
  const isProduct = upload.result !== null;

  const confirm = () =>
    remove.mutate(upload.id, {
      onSuccess: () => {
        setOpen(false);
        toast.success(`${name} deleted`);
        close();
      },
    });

  return (
    <>
      {/* Full width, outlined in red with no fill: plainly destructive, without shouting. A pale
          red fill on hover and focus says it's live. */}
      <Button
        variant="outline"
        aria-haspopup="dialog"
        className="w-full border-danger bg-transparent text-danger hover:bg-danger-soft hover:text-danger focus-visible:bg-danger-soft"
        onClick={() => setOpen(true)}
      >
        <Trash2 data-icon="inline-start" aria-hidden />
        {isProduct ? 'Delete product' : 'Delete upload'}
      </Button>
      <ConfirmDialog
        open={open}
        title={`Delete ${name}?`}
        description={
          isProduct
            ? `Its data and its file, ${upload.fileName}, are removed for good. The activity log keeps its history.`
            : 'Its file is removed for good. The activity log keeps its history.'
        }
        confirmLabel="Delete"
        cancelLabel="Keep it"
        variant="destructive"
        request={remove}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
