import type { ComponentProps } from 'react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * A filter as a segmented tab control, in the style of the tab switcher on supplyscope.io: the
 * active option is white with a soft shadow. Used inside a <Tabs> that holds the selection.
 */
export function SegmentedTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <TabsList className={cn('h-9', className)} {...props} />;
}

export function SegmentedTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        'gap-1 px-2 text-[13px] data-active:bg-card data-active:shadow-[0_0_20px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.08)]',
        className,
      )}
      {...props}
    />
  );
}
