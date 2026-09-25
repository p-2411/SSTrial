import { canRetryUpload, type UploadDetail } from '@label-extractor/shared';
import { errorMessage } from '../../api/client.ts';
import { useRetryUpload } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import { ProgressBar } from '../../components/ProgressBar.tsx';
import { cx } from '../../lib/cx.ts';
import styles from './StatusNotice.module.css';

/** Explains a not-yet-completed upload: waiting, working, retrying, or failed (with a retry button). */
export function StatusNotice({ upload }: { upload: UploadDetail }) {
  const retry = useRetryUpload();
  const attempt = `attempt ${upload.attempts} of ${upload.maxAttempts}`;

  switch (upload.status) {
    case 'queued':
      if (upload.error) {
        return (
          <div className={cx(styles.notice, styles.retrying)} role="status">
            <p className={styles.title}>Retrying automatically</p>
            <p>
              {upload.error.message} That was {attempt}; the next attempt starts shortly.
            </p>
          </div>
        );
      }
      return (
        <div className={styles.notice} role="status">
          <p className={styles.title}>Waiting to be processed</p>
          <p>Processing usually starts within a few seconds.</p>
          <ProgressBar label="Waiting to be processed" />
        </div>
      );

    case 'processing':
    case 'uploading':
      return (
        <div className={cx(styles.notice, styles.processing)} role="status">
          <p className={styles.title}>Reading the label{upload.attempts > 1 && `, ${attempt}`}</p>
          <p>This usually takes 5 to 20 seconds.</p>
          <ProgressBar label="Reading the label" />
        </div>
      );

    case 'failed': {
      const retryable = canRetryUpload(upload);
      return (
        <div className={cx(styles.notice, styles.failed)} role="alert">
          <p className={styles.title}>Couldn't extract this label</p>
          <p>{upload.error?.message ?? 'Processing failed.'}</p>
          {retryable ? (
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => retry.mutate(upload.id)} disabled={retry.isPending}>
                {retry.isPending ? 'Retrying…' : 'Retry extraction'}
              </Button>
              {retry.isError && <p className={styles.actionError}>{errorMessage(retry.error)}</p>}
            </div>
          ) : (
            <p className={styles.hint}>Upload a different file to try again.</p>
          )}
        </div>
      );
    }

    case 'completed':
      return null;
  }
}
