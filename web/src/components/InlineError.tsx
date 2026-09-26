import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TONE_CLASSES } from '@/lib/tone';

interface InlineErrorProps {
  title: string;
  message: string;
  /** When provided, shows a button that retries whatever failed. */
  onRetry?: () => void;
  retrying?: boolean;
  /** The retry button's label, when "Try again" isn't what it does (say, "Reload"). */
  retryLabel?: string;
  /**
   * One line of small red text, for a tight spot such as under an event in a list. Otherwise a
   * boxed alert with an icon, for a card or a page.
   */
  compact?: boolean;
  /** Another way out, beside the retry button (a link home, say). */
  children?: ReactNode;
}

/** A failed request, explained, with a way to try again. */
export function InlineError({ title, message, onRetry, retrying = false, retryLabel = 'Try again', compact = false, children }: InlineErrorProps) {
  const retry = onRetry && (
    <Button variant="outline" size="sm" onClick={onRetry} loading={retrying} className="text-foreground">
      {retryLabel}
    </Button>
  );

  if (compact) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-x-2 text-xs text-danger">
        {title}. {message}
        {onRetry && (
          <Button variant="link" size="xs" className="h-auto p-0 text-xs" loading={retrying} onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </p>
    );
  }

  return (
    <Alert className={TONE_CLASSES.danger}>
      <AlertCircle />
      <AlertTitle className="font-semibold">{title}</AlertTitle>
      <AlertDescription className="text-danger/90">
        <p>{message}</p>
        {(retry || children) && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {retry}
            {children}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
