import { Send } from 'lucide-react';
import { canSubmitUpload, type UploadDetail } from '@label-extractor/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSubmitToProducts } from './useSubmitToProducts';

/**
 * While an upload waits in Review, the way to put it into Products: a button floating over the
 * bottom of the panel (sticky), so it's to hand wherever the person has scrolled. It's the panel's
 * last item, so at the very end it takes its own place below Delete, and both show. Until nothing
 * is left to check it's disabled, and says so.
 */
export function SubmitToProducts({ upload }: { upload: UploadDetail }) {
  const { submitToProducts, submitting } = useSubmitToProducts();
  const ready = canSubmitUpload(upload);

  return (
    // bottom-0: sticky keeps clear of the panel's padding, and that 12px (pb-3) is the gap.
    <div className="sticky bottom-0 z-10">
      {/* It sits over the content, so everything is solid: the border takes the fill's colour (a
          button's is otherwise transparent, and showed what's behind it), hovering lightens both
          rather than fading them, and not ready is plain grey rather than faded. A soft shadow below
          lifts it off the page. */}
      <Button
        size="lg"
        className={cn(
          'h-12 w-full shadow-[0_8px_24px_-6px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)]',
          ready
            ? 'border-primary hover:border-[color-mix(in_oklch,var(--primary),white_18%)] hover:bg-[color-mix(in_oklch,var(--primary),white_18%)]'
            : 'disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
        )}
        disabled={!ready}
        loading={submitting}
        onClick={() => submitToProducts([upload.id])}
      >
        <Send data-icon="inline-start" aria-hidden />
        {ready ? 'Submit to Products' : 'Check the flagged fields to submit'}
      </Button>
    </div>
  );
}
