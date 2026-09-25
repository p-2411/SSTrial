import { useCallback, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { UploadDetail } from '@label-extractor/shared';
import { FileTypeTag } from '@/components/FileTypeTile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PdfFirstPage } from './PdfFirstPage';

/**
 * The original file, so the user can check the extraction against the real label: a white header
 * bar with the file type and an "open in new tab" button, and the preview filling the card below.
 * Images show as they are; PDFs show their first page, drawn as an image.
 *
 * The API issues a fresh signed URL on every poll; keeping the first one stops the preview
 * re-downloading every two seconds while the upload is processing.
 */
export function SourceDocumentCard({ upload }: { upload: UploadDetail }) {
  const [url, setUrl] = useState(upload.fileUrl);
  const [failed, setFailed] = useState(false);
  const markFailed = useCallback(() => setFailed(true), []);
  // Adopt a URL if the first response didn't have one (e.g. storage was briefly unavailable).
  if (!url && upload.fileUrl) setUrl(upload.fileUrl);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-2">
        <FileTypeTag mimeType={upload.mimeType} />
        {url && (
          <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
            <a href={url} target="_blank" rel="noreferrer" aria-label="Open original file in a new tab" title="Open original">
              <ExternalLink aria-hidden />
            </a>
          </Button>
        )}
      </div>

      {!url || failed ? (
        <div className="grid min-h-48 place-items-center bg-muted text-sm text-muted-foreground">Preview unavailable</div>
      ) : upload.mimeType === 'application/pdf' ? (
        <PdfFirstPage url={url} fileName={upload.fileName} onError={markFailed} />
      ) : (
        <img className="block h-auto w-full" src={url} alt={`Original label: ${upload.fileName}`} onError={markFailed} />
      )}
    </Card>
  );
}
