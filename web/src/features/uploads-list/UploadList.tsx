import { InlineError } from '../../components/InlineError.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { useUploadList } from '../../api/queries.ts';
import { errorMessage } from '../../api/client.ts';
import { useNow } from '../../lib/useNow.ts';
import { PendingUploadRow } from '../upload/PendingUploadRow.tsx';
import type { PendingUpload } from '../upload/useFileUploads.ts';
import { UploadRow } from './UploadRow.tsx';
import { useStatusAnnouncements } from './useStatusAnnouncements.ts';
import rowStyles from './UploadRow.module.css';
import styles from './UploadList.module.css';

interface UploadListProps {
  /** Files still being sent from this browser; shown above the server's list. */
  pending: PendingUpload[];
  onRetryPending: (upload: PendingUpload) => void;
  onDismissPending: (localId: string) => void;
}

export function UploadList({ pending, onRetryPending, onDismissPending }: UploadListProps) {
  const { data: uploads, isPending, isError, error, refetch, isRefetching } = useUploadList();
  const now = useNow();
  const announcement = useStatusAnnouncements(uploads);

  const inProgress = uploads?.filter((u) => u.status === 'queued' || u.status === 'processing').length ?? 0;
  const isEmpty = uploads?.length === 0 && pending.length === 0;

  return (
    <section aria-labelledby="uploads-heading" className={styles.section}>
      <header className={styles.header}>
        <h2 id="uploads-heading" className={styles.heading}>
          Uploads
        </h2>
        {uploads && uploads.length > 0 && (
          <p className={styles.count}>
            {uploads.length} {uploads.length === 1 ? 'file' : 'files'}
            {inProgress > 0 && `, ${inProgress} in progress`}
          </p>
        )}
      </header>

      {/* Refresh failed but we still have data: keep showing it, and say it may be out of date. */}
      {isError && uploads && (
        <p role="status" className={styles.stale}>
          Couldn't refresh the list, so statuses may be out of date. {errorMessage(error)}
        </p>
      )}

      {(pending.length > 0 || (uploads && uploads.length > 0)) && (
        <ul className={styles.list}>
          {pending.map((upload) => (
            <PendingUploadRow key={upload.localId} upload={upload} onRetry={onRetryPending} onDismiss={onDismissPending} />
          ))}
          {uploads?.map((upload) => <UploadRow key={upload.id} upload={upload} now={now} />)}
        </ul>
      )}

      {isPending && <ListSkeleton />}

      {isError && !uploads && (
        <InlineError
          title="Couldn't load your uploads"
          message={errorMessage(error)}
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      )}

      {isEmpty && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No uploads yet</p>
          <p>
            Add a label photo or PDF above. Each file is read in the background, and its product name, brand,
            ingredients, allergens and net weight appear here.
          </p>
        </div>
      )}

      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
    </section>
  );
}

function ListSkeleton() {
  return (
    <ul className={styles.list} aria-label="Loading uploads">
      {[0, 1, 2].map((i) => (
        <li key={i} className={rowStyles.row}>
          <Skeleton width={80} />
          <div>
            <Skeleton width="70%" />
            <Skeleton width="45%" height={11} style={{ marginTop: 8 }} />
          </div>
          <Skeleton width={60} />
        </li>
      ))}
    </ul>
  );
}
