import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { UploadDetail } from '@label-extractor/shared';
import { FileTypeTag } from '@/components/FileTypeTile';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The original file, filling its card, with the file-type tag and an "open" link laid over it —
 * so the user can check the extraction against the real label.
 *
 * The API issues a fresh signed URL on every poll; keeping the first one stops the image
 * re-downloading every two seconds while the upload is processing.
 */
export function SourceDocumentCard({ upload }: { upload: UploadDetail }) {
  const [url, setUrl] = useState(upload.fileUrl);
  const [failed, setFailed] = useState(false);
  // Adopt a URL if the first response didn't have one (e.g. storage was briefly unavailable).
  if (!url && upload.fileUrl) setUrl(upload.fileUrl);
  const available = Boolean(url) && !failed;

  return (
    <Card className="relative gap-0 overflow-hidden bg-muted p-0">
      {!available ? (
        <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">Preview unavailable</div>
      ) : upload.mimeType === 'application/pdf' ? (
        <iframe className="block h-[36rem] w-full" src={url!} title={`Original PDF: ${upload.fileName}`} />
      ) : (
        <img className="block h-auto w-full" src={url!} alt={`Original label: ${upload.fileName}`} onError={() => setFailed(true)} />
      )}

      <div className="absolute top-3 left-3">
        <FileTypeTag mimeType={upload.mimeType} />
      </div>
      {available && (
        <a
          href={url!}
          target="_blank"
          rel="noreferrer"
          aria-label="Open original file in a new tab"
          title="Open original"
          // Kept clear of the PDF viewer's own toolbar, which sits along the top.
          className={cn(
            'absolute right-3 grid size-8 place-items-center rounded-md bg-card/90 text-foreground shadow-sm ring-1 ring-border backdrop-blur hover:bg-card',
            upload.mimeType === 'application/pdf' ? 'bottom-3' : 'top-3',
          )}
        >
          <ExternalLink className="size-4" aria-hidden />
        </a>
      )}
    </Card>
  );
}
