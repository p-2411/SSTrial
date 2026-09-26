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
}

/** A failed request, explained, with a way to try again. */
export function InlineError({ title, message, onRetry, retrying = false }: InlineErrorProps) {
  return (
    <Alert className={TONE_CLASSES.danger}>
      <AlertCircle />
      <AlertTitle className="font-semibold">{title}</AlertTitle>
      <AlertDescription className="text-danger/90">
        <p>{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} loading={retrying} className="mt-2 text-foreground">
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
