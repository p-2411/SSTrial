import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { canSubmitUpload, type UploadDetail } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useSubmitUploads } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * While an upload waits in Review, the way to put it into Products: a button floating over the
 * bottom of the panel (sticky), so it's to hand wherever the person has scrolled. It's the panel's
 * last item, so at the very end it takes its own place below Delete, and both show. Until nothing
 * is left to check it's disabled, and says so.
 */
export function SubmitToProducts({ upload }: { upload: UploadDetail }) {
  const submit = useSubmitUploads();
  const ready = canSubmitUpload(upload);

  const onClick = () =>
    submit.mutate([upload.id], {
      onSuccess: ([submitted]) => {
        if (submitted) toast.success('Added to Products');
        else toast.warning("It wasn't submitted", { description: 'It changed since you opened it. Check it again.' });
      },
      onError: (failure) => toast.error("Couldn't submit", { description: errorMessage(failure) }),
    });

  return (
    // bottom-0: sticky keeps clear of the panel's padding, and that 20px (pb-5) is the gap, the
    // same as between the detail's cards.
    <div className="sticky bottom-0 z-10">
      {/* It sits over the content, so everything is solid: the border takes the fill's colour (a
          button's is otherwise transparent, and showed what's behind it), hovering lightens both
          rather than fading them, and not ready is plain grey rather than faded. h-11 is the
          Product information card's footer's height. */}
      <Button
        size="lg"
        className={cn(
          'h-11 w-full shadow-lg',
          ready
            ? 'border-primary hover:border-[color-mix(in_oklch,var(--primary),white_18%)] hover:bg-[color-mix(in_oklch,var(--primary),white_18%)]'
            : 'disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
        )}
        disabled={!ready}
        loading={submit.isPending}
        onClick={onClick}
      >
        <Send data-icon="inline-start" aria-hidden />
        {ready ? 'Submit to Products' : 'Check the flagged fields to submit'}
      </Button>
    </div>
  );
}
