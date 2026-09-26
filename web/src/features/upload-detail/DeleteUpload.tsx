import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { UploadDetail } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useDeleteUpload } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { useCloseDetail } from './UploadDetailPanel';

/**
 * Deleting the upload, offered to whoever may (its uploader or an admin: the server says, as
 * `canDelete`). It can't be undone, so it asks first, in place: the question takes a line of its
 * own below the button's row (`basis-full`, in the header's wrapping row). Then the panel closes.
 */
export function DeleteUpload({ upload }: { upload: Pick<UploadDetail, 'id' | 'fileName'> }) {
  const remove = useDeleteUpload();
  const close = useCloseDetail();
  const [confirming, setConfirming] = useState(false);
  const questionId = useId();

  if (!confirming) {
    return (
      <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground hover:text-danger" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden />
        Delete
      </Button>
    );
  }

  const confirm = () =>
    remove.mutate(upload.id, {
      onSuccess: () => {
        toast(`Deleted ${upload.fileName}`);
        close();
      },
    });
  const cancel = () => {
    remove.reset();
    setConfirming(false);
  };

  return (
    <div role="group" aria-labelledby={questionId} className={cn('grid basis-full gap-2 rounded-lg border p-3 text-sm', TONE_CLASSES.danger)}>
      <p id={questionId}>
        Delete <span className="font-semibold">{upload.fileName}</span>? Its file and extracted data are removed for
        good. The activity log keeps its history.
      </p>
      {remove.isError && <p role="alert">{errorMessage(remove.error)}</p>}
      <div className="flex gap-2">
        <Button size="xs" variant="destructive" disabled={remove.isPending} onClick={confirm}>
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </Button>
        <Button size="xs" variant="outline" disabled={remove.isPending} onClick={cancel}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
