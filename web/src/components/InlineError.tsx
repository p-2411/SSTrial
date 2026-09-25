import { Button } from './Button.tsx';
import styles from './InlineError.module.css';

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
    <div role="alert" className={styles.error}>
      <p className={styles.title}>{title}</p>
      <p>{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} disabled={retrying} className={styles.action}>
          {retrying ? 'Trying again…' : 'Try again'}
        </Button>
      )}
    </div>
  );
}
