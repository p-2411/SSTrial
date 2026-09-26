import { FileWarning, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { canRetryUpload, type UploadDetail } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useRetryUpload } from '@/api/queries';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TONE_CLASSES } from '@/lib/tone';
import { uploadState } from '@/lib/uploadState';

/**
 * Explains an upload that didn't end in readable data: it failed (with a retry button, if running
 * it again could help), or its saved result can't be read. Uploads still being worked on never get
 * here: the detail shows its loading state until they're done.
 */
export function StatusNotice({ upload }: { upload: UploadDetail }) {
  const state = uploadState(upload);
  switch (state.kind) {
    case 'failed':
      return (
        <Alert className={TONE_CLASSES.danger}>
          <XCircle />
          <AlertTitle className="font-semibold">Couldn't extract this label</AlertTitle>
          <AlertDescription className="text-danger/90">
            <p>{state.error?.message ?? 'Processing failed.'}</p>
            {canRetryUpload(upload) ? (
              <RetryButton uploadId={upload.id} label="Retry extraction" />
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Upload a different file to try again.</p>
            )}
          </AlertDescription>
        </Alert>
      );

    case 'unreadable':
      // Saved in a shape this version can't read: say so, rather than showing an empty page.
      return (
        <Alert className={TONE_CLASSES.warning}>
          <FileWarning />
          <AlertTitle className="font-semibold">This result can't be displayed</AlertTitle>
          <AlertDescription className="text-warning/90">
            <p>It was saved in a format this version of the app can't read. Run the extraction again to replace it.</p>
            <RetryButton uploadId={upload.id} label="Run extraction again" />
          </AlertDescription>
        </Alert>
      );

    default:
      return null;
  }
}

/** Queues the extraction again (indigo: it's an AI action) and confirms with a toast. */
function RetryButton({ uploadId, label }: { uploadId: string; label: string }) {
  const retry = useRetryUpload();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button
        variant="brand"
        loading={retry.isPending}
        onClick={() => retry.mutate(uploadId, { onSuccess: () => toast.success('Extraction queued again') })}
      >
        <Sparkles data-icon="inline-start" aria-hidden />
        {label}
      </Button>
      {retry.isError && <span className="text-sm">{errorMessage(retry.error)}</span>}
    </div>
  );
}
