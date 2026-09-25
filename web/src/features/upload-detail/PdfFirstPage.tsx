import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Pixel width to render the page at; CSS scales it down to the card, so it stays sharp on high-DPI screens. */
const RENDER_WIDTH = 1600;

/**
 * Draws the first page of a PDF as an image, so PDFs preview exactly like photos instead of in a
 * full PDF viewer (the "open" button covers anyone who wants the whole document).
 *
 * pdf.js is imported on demand, so it's only downloaded when a PDF is actually shown.
 */
export function PdfFirstPage({ url, fileName, onError }: { url: string; fileName: string; onError: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

        task = pdfjs.getDocument({ url });
        const page = await (await task.promise).getPage(1);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;

        const viewport = page.getViewport({ scale: RENDER_WIDTH / page.getViewport({ scale: 1 }).width });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) onError();
      }
    })();

    // Switching uploads (or unmounting) mid-load stops the download and frees the worker.
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, onError]);

  return (
    <>
      {!ready && <Skeleton className="aspect-[3/4] w-full rounded-none" aria-label="Loading preview" />}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`First page of ${fileName}`}
        className={cn('block h-auto w-full', !ready && 'hidden')}
      />
    </>
  );
}
