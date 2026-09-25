import { useEffect, useRef, useState } from 'react';
import type { UploadStatus, UploadSummary } from '@label-extractor/shared';

/**
 * Text for a screen-reader live region: announces when an upload finishes or fails, so users who
 * can't see the badges change still find out. Ignores the initial load.
 */
export function useStatusAnnouncements(uploads: UploadSummary[] | undefined): string {
  const previous = useRef<Map<string, UploadStatus> | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!uploads) return;
    const before = previous.current;
    previous.current = new Map(uploads.map((u) => [u.id, u.status]));
    if (!before) return;

    const changes = uploads
      .filter((u) => before.get(u.id) !== u.status && (u.status === 'completed' || u.status === 'failed'))
      .map((u) => `${u.fileName} ${u.status === 'completed' ? 'completed' : 'failed'}.`);
    if (changes.length > 0) setMessage(changes.join(' '));
  }, [uploads]);

  return message;
}
