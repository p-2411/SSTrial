import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { useSubmitUploads } from '@/api/queries';
import { toastBatchResult } from '@/lib/toasts';

/**
 * Submitting uploads from Review into Products, from the Review tab or one upload's detail, with
 * the toasts that say how it went: how many went in, how many didn't because they changed since
 * the person looked, or why it failed. The server only takes those with nothing left to check.
 */
export function useSubmitToProducts() {
  const submit = useSubmitUploads();

  const submitToProducts = (ids: string[], onSubmitted?: () => void) =>
    submit.mutate(ids, {
      onSuccess: (submitted) => {
        onSubmitted?.();
        toastBatchResult(submitted.length, ids.length, {
          done: 'submitted to Products',
          skipped: 'not submitted',
          why: ids.length === 1 ? 'It changed since you opened it. Check it again.' : 'They changed since you looked. Check them again.',
        });
      },
      onError: (failure) => toast.error("Couldn't submit", { description: errorMessage(failure) }),
    });

  return { submitToProducts, submitting: submit.isPending };
}
