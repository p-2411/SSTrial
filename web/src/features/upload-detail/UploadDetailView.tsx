import { Link, useParams } from 'react-router';
import { formatBytes, type UploadDetail } from '@label-extractor/shared';
import { ApiRequestError, errorMessage } from '../../api/client.ts';
import { useUploadDetail } from '../../api/queries.ts';
import { InlineError } from '../../components/InlineError.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { fileTypeLabel, formatDateTime, formatRelativeTime } from '../../lib/format.ts';
import { FilePreview } from './FilePreview.tsx';
import { JsonDisclosure } from './JsonDisclosure.tsx';
import { LabelPanel } from './LabelPanel.tsx';
import { StatusNotice } from './StatusNotice.tsx';
import styles from './UploadDetailView.module.css';

/** Route: /uploads/:id — everything about one upload. */
export function UploadDetailView() {
  const { id = '' } = useParams();
  const { data: upload, isPending, isError, error, refetch, isRefetching } = useUploadDetail(id);

  return (
    <div className={styles.view}>
      {/* Only visible on narrow screens, where the list and the detail are separate pages. */}
      <Link to="/" className={styles.back}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        All uploads
      </Link>

      {isPending && <DetailSkeleton />}

      {isError && !upload &&
        (error instanceof ApiRequestError && error.status === 404 ? (
          <div className={styles.notFound}>
            <h1 className={styles.fileName}>Upload not found</h1>
            <p>This upload doesn't exist. Check the link, or pick an upload from the list.</p>
          </div>
        ) : (
          <InlineError
            title="Couldn't load this upload"
            message={errorMessage(error)}
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        ))}

      {upload && <Detail upload={upload} />}
    </div>
  );
}

function Detail({ upload }: { upload: UploadDetail }) {
  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.fileName} title={upload.fileName}>
          {upload.fileName}
        </h1>
        <StatusBadge status={upload.status} />
      </header>
      <dl className={styles.facts}>
        <div>
          <dt>Uploaded</dt>
          <dd>
            <time dateTime={upload.createdAt} title={formatDateTime(upload.createdAt)}>
              {formatRelativeTime(upload.createdAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>
            {fileTypeLabel(upload.mimeType)}, {formatBytes(upload.sizeBytes)}
          </dd>
        </div>
        {upload.attempts > 0 && (
          <div>
            <dt>Attempts</dt>
            <dd>
              {upload.attempts} of {upload.maxAttempts}
            </dd>
          </div>
        )}
      </dl>

      <StatusNotice upload={upload} />

      <div className={styles.columns}>
        {upload.result && (
          <div className={styles.panelColumn}>
            <LabelPanel result={upload.result} />
            <JsonDisclosure data={upload.result} />
          </div>
        )}
        {/* Keyed by id so switching uploads resets the remembered preview URL. */}
        <FilePreview key={upload.id} upload={upload} />
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-label="Loading upload" className={styles.skeleton}>
      <Skeleton width="55%" height={26} />
      <Skeleton width="35%" />
      <Skeleton height={220} style={{ marginTop: 16, maxWidth: 544 }} />
    </div>
  );
}
