import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeleteUploadsDialog } from './DeleteUploadsDialog';

/**
 * Deletes the picked uploads (`ids`) together: a Delete button, there while any are picked, and the
 * dialog it opens, since deleting can't be undone (see DeleteUploadsDialog).
 */
export function DeleteSelected({ ids }: { ids: string[] }) {
  // The uploads the dialog asks about, fixed as it opens: the list may change underneath it.
  const [confirming, setConfirming] = useState<string[] | null>(null);

  if (ids.length === 0 && confirming === null) return null;

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
      <DeleteUploadsDialog
        ids={confirming}
        verb="Delete"
        description="Their files and extracted data are removed for good. The activity log keeps their history."
        skippedWhy="Only whoever uploaded it, or an admin, can delete it."
        onClose={() => setConfirming(null)}
      />
    </>
  );
}
