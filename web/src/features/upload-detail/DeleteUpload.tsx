import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { UploadDetail } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useDeleteUpload } from '@/api/queries';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useCloseDetail } from './UploadDetailPanel';

/**
 * Deleting the upload, offered to whoever may (its uploader or an admin: the server says, as
 * `canDelete`). It can't be undone, so it asks first, in a dialog that stays open until the delete
 * is done, or says why it was refused. Then the panel closes.
 */
export function DeleteUpload({ upload }: { upload: Pick<UploadDetail, 'id' | 'fileName'> }) {
  const remove = useDeleteUpload();
  const close = useCloseDetail();
  const [open, setOpen] = useState(false);

  const confirm = () =>
    remove.mutate(upload.id, {
      onSuccess: () => {
        setOpen(false);
        toast(`Deleted ${upload.fileName}`);
        close();
      },
    });
  const onOpenChange = (next: boolean) => {
    if (remove.isPending) return; // no walking away mid-delete
    if (!next) remove.reset(); // a refusal shouldn't greet the next attempt
    setOpen(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        {/* Full width, outlined in red with no fill: plainly destructive, without shouting. A pale
            red fill on hover and focus says it's live. */}
        <Button variant="outline" className="w-full border-danger bg-transparent text-danger hover:bg-danger-soft hover:text-danger focus-visible:bg-danger-soft">
          <Trash2 data-icon="inline-start" aria-hidden />
          Delete upload
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {upload.fileName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its file and extracted data are removed for good. The activity log keeps its history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && (
          <p role="alert" className="text-danger">
            {errorMessage(remove.error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={remove.isPending}>
              Keep it
            </Button>
          </AlertDialogCancel>
          <Button variant="destructive" loading={remove.isPending} onClick={confirm}>
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
