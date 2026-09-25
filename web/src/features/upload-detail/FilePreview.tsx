import { useState } from 'react';
import type { UploadDetail } from '@label-extractor/shared';
import styles from './FilePreview.module.css';

/**
 * The original file, so the user can check the extraction against the real label.
 *
 * The API issues a fresh signed URL on every poll; keeping the first one stops the image
 * re-downloading every two seconds while the upload is processing.
 */
export function FilePreview({ upload }: { upload: UploadDetail }) {
  const [url, setUrl] = useState(upload.fileUrl);
  const [failed, setFailed] = useState(false);
  // Adopt a URL if the first response didn't have one (e.g. storage was briefly unavailable).
  if (!url && upload.fileUrl) setUrl(upload.fileUrl);

  if (!url || failed) {
    return <div className={styles.unavailable}>Preview unavailable</div>;
  }

  return (
    <figure className={styles.figure}>
      {upload.mimeType === 'application/pdf' ? (
        <iframe className={styles.frame} src={url} title={`Original PDF: ${upload.fileName}`} />
      ) : (
        <img className={styles.image} src={url} alt={`Original label: ${upload.fileName}`} onError={() => setFailed(true)} />
      )}
      <figcaption className={styles.caption}>
        <a href={url} target="_blank" rel="noreferrer">
          Open original file
        </a>
      </figcaption>
    </figure>
  );
}
