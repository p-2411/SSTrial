import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { UploadDetail } from '@label-extractor/shared';
import { FileTypeTag } from '@/components/FileTypeTile';
import { Card } from '@/components/ui/card';

/**
 * The original file, so the user can check the extraction against the real label.
 *
 * The API issues a fresh signed URL on every poll; keeping the first one stops the image
 * re-downloading every two seconds while the upload is processing.
 */
export function SourceDocumentCard({ upload }: { upload: UploadDetail }) {
  const [url, setUrl] = useState(upload.fileUrl);
  const [failed, setFailed] = useState(false);
  // Adopt a URL if the first response didn't have one (e.g. storage was briefly unavailable).
  if (!url && upload.fileUrl) setUrl(upload.fileUrl);

  return (
    <Card className="gap-3 p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <FileTypeTag mimeType={upload.mimeType} />
        {url && !failed && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Open original <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
      {!url || failed ? (
        <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Preview unavailable
        </div>
      ) : upload.mimeType === 'application/pdf' ? (
        <iframe className="h-[28rem] w-full rounded-lg border bg-muted" src={url} title={`Original PDF: ${upload.fileName}`} />
      ) : (
        <img
          className="max-h-[28rem] w-full rounded-lg border bg-muted object-contain"
          src={url}
          alt={`Original label: ${upload.fileName}`}
          onError={() => setFailed(true)}
        />
      )}
    </Card>
  );
}
