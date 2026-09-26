import { useEffect, useRef, useState } from 'react';
import { isActiveStatus, type UploadSummary } from '@label-extractor/shared';

/**
 * Text for a screen-reader live region over "Your uploads": announces when one of them fails, or
 * finishes (it leaves this list for Products), so users who can't see the rows change still find
 * out. Ignores the initial load.
 */
export function useUploadAnnouncements(uploads: UploadSummary[] | undefined): string {
  const previous = useRef<Map<string, UploadSummary> | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!uploads) return;
    const before = previous.current;
    const now = new Map(uploads.map((upload) => [upload.id, upload]));
    previous.current = now;
    if (!before) return;

    const changes: string[] = [];
    for (const [id, was] of before) {
      const is = now.get(id);
      // Gone while still being worked on: it was read, and moved to Products.
      if (!is && isActiveStatus(was.status)) changes.push(`${was.fileName} is ready.`);
      else if (is?.status === 'failed' && was.status !== 'failed') changes.push(`${is.fileName} failed.`);
    }
    if (changes.length > 0) setMessage(changes.join(' '));
  }, [uploads]);

  return message;
}
