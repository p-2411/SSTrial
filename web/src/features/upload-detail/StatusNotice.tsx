import { Clock, FileWarning, RotateCw, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { canRetryUpload, type UploadDetail } from '@label-extractor/shared';
import { errorMessage } from '@/api/client';
import { useRetryUpload } from '@/api/queries';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Explains a not-yet-completed upload: waiting, being read, retrying, or failed (with a retry button). */
export function StatusNotice({ upload }: { upload: UploadDetail }) {

  switch (upload.status) {
    case 'queued':
      if (upload.error) {
        return (
          <Alert role="status" className="border-warning-border bg-warning-soft text-warning">
            <RotateCw />
            <AlertTitle className="font-semibold">Retrying automatically</AlertTitle>
            <AlertDescription className="text-warning/90">
              {upload.error.message} It will be tried again shortly.
            </AlertDescription>
          </Alert>
        );
      }
      return (
        <Alert role="status">
          <Clock />
          <AlertTitle className="font-semibold">Waiting to be processed</AlertTitle>
          <AlertDescription>Processing usually starts within a few seconds.</AlertDescription>
        </Alert>
      );

    case 'processing':
    case 'uploading':
      return (
        <Alert role="status" className="border-brand/20 bg-brand-soft text-brand">
          <Sparkles className="animate-pulse motion-reduce:animate-none" />
          <AlertTitle className="font-semibold">AI agent is reading the label</AlertTitle>
          <AlertDescription className="text-brand/80">This usually takes 5 to 20 seconds.</AlertDescription>
        </Alert>
      );

    case 'failed': {
      const retryable = canRetryUpload(upload);
      return (
        <Alert className="border-danger-border bg-danger-soft text-danger">
          <XCircle />
          <AlertTitle className="font-semibold">Couldn't extract this label</AlertTitle>
          <AlertDescription className="text-danger/90">
            <p>{upload.error?.message ?? 'Processing failed.'}</p>
            {retryable ? (
              <RetryButton uploadId={upload.id} label="Retry extraction" />
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Upload a different file to try again.</p>
            )}
          </AlertDescription>
        </Alert>
      );
    }

    case 'completed':
      // Saved in a shape this version can't read: say so, rather than showing an empty page.
      if (upload.resultUnreadable) {
        return (
          <Alert className="border-warning-border bg-warning-soft text-warning">
            <FileWarning />
            <AlertTitle className="font-semibold">This result can't be displayed</AlertTitle>
            <AlertDescription className="text-warning/90">
              <p>It was saved in a format this version of the app can't read. Run the extraction again to replace it.</p>
              <RetryButton uploadId={upload.id} label="Run extraction again" />
            </AlertDescription>
          </Alert>
        );
      }
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
        disabled={retry.isPending}
        onClick={() => retry.mutate(uploadId, { onSuccess: () => toast.success('Extraction queued again') })}
      >
        <Sparkles data-icon="inline-start" aria-hidden />
        {retry.isPending ? 'Queuing…' : label}
      </Button>
      {retry.isError && <span className="text-sm">{errorMessage(retry.error)}</span>}
    </div>
  );
}
