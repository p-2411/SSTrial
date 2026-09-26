import { Dropzone } from '@/features/upload/Dropzone';
import { useFileUploadsContext } from '@/features/upload/FileUploadsProvider';
import { UploadDetailPanel } from '@/features/upload-detail/UploadDetailPanel';
import { cn } from '@/lib/utils';
import { ProductList } from './ProductList';
import { YourUploads } from './YourUploads';

/**
 * Routes / and /uploads/:id: where labels come in and go, with the open upload in a panel beside
 * them. Upload, where files are dropped; the person's own uploads, being uploaded and read, then
 * waiting for them to review and submit (private to them); and Products, everyone's.
 */
export function UploadsPage() {
  const { pending, addFiles, retry, dismiss } = useFileUploadsContext();
  return (
    // Full height: the lists and the detail panel each scroll on their own.
    // @container/uploads: the detail panel sizes itself as a share of this row's width, and covers
    // the list when the row is too narrow for both (see UploadDetailPanel).
    <div className="group/uploads @container/uploads relative flex min-h-0 flex-1">
      {/* The scrollbar's space is always reserved, on both sides so the centred content stays
          centred: a list growing past the fold mustn't make everything shift sideways. Once the
          open panel has slid over it, the list is hidden, so Tab and screen readers can't wander
          into rows nobody can see. The delay is on the way in only (a transition is the entered
          state's), so the list is back the moment the panel closes, for focus to return to its row. */}
      <div
        className={cn(
          'min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]',
          '@max-side-by-side/uploads:group-has-[>aside[data-open=true]]/uploads:invisible',
          '@max-side-by-side/uploads:group-has-[>aside[data-open=true]]/uploads:transition-[visibility]',
          '@max-side-by-side/uploads:group-has-[>aside[data-open=true]]/uploads:duration-300',
          'motion-reduce:transition-none',
        )}
      >
        <div className="mx-auto grid max-w-4xl grid-cols-1 content-start gap-4 p-6">
          <Dropzone onUpload={addFiles} />
          <YourUploads pending={pending} onRetry={retry} onDismiss={dismiss} />
          <ProductList />
        </div>
      </div>
      <UploadDetailPanel />
    </div>
  );
}
