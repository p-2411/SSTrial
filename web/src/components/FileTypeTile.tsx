import { FileText, Image } from 'lucide-react';
import type { SupportedMimeType } from '@label-extractor/shared';
import { cn } from '@/lib/utils';
import { fileTypeLabel } from '@/lib/format';

const isPdf = (mimeType: SupportedMimeType) => mimeType === 'application/pdf';

/** Square icon tile for list rows: magenta for documents (like SupplyScope's "PDF" tag), indigo for images. */
export function FileTypeTile({ mimeType, className }: { mimeType: SupportedMimeType; className?: string }) {
  const Icon = isPdf(mimeType) ? FileText : Image;
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg',
        isPdf(mimeType) ? 'bg-document-soft text-document' : 'bg-brand-soft text-brand',
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** Small solid tag naming the file type, e.g. "PDF", pinned to a document preview. */
export function FileTypeTag({ mimeType }: { mimeType: SupportedMimeType }) {
  return (
    <span
      className={cn(
        'rounded-md px-2 py-0.5 text-xs font-semibold text-white',
        isPdf(mimeType) ? 'bg-document' : 'bg-brand',
      )}
    >
      {fileTypeLabel(mimeType)}
    </span>
  );
}
