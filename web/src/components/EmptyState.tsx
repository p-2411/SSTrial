import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  /** Pictures what's missing. Not shown when `compact`. */
  icon?: LucideIcon;
  /** What there is (nothing yet, nothing matching). */
  title: string;
  /** What to do about it, or why it's so. */
  hint?: ReactNode;
  /** The way out, such as clearing the filters that match nothing. */
  action?: { label: string; onClick: () => void };
  /** A line of text and its action, left-aligned, for a small space inside a card (a history). */
  compact?: boolean;
}

/**
 * A list with nothing to show, once it has loaded: says so, says why or what to do next, and
 * offers the way out when there is one. Lists only show it after their first page has arrived, so
 * it never flashes up before the data does.
 */
export function EmptyState({ icon: Icon, title, hint, action, compact = false }: EmptyStateProps) {
  const button = action && (
    <Button variant="outline" size="sm" onClick={action.onClick}>
      {action.label}
    </Button>
  );

  if (compact) {
    return (
      <div className="grid grid-cols-1 justify-items-start gap-2">
        <p className="text-sm text-muted-foreground">
          {title}
          {hint && <> {hint}</>}
        </p>
        {button}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {Icon && (
        <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {button}
    </div>
  );
}
