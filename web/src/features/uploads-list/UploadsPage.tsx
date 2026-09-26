import { Dropzone } from '@/features/upload/Dropzone';
import { useFileUploadsContext } from '@/features/upload/FileUploadsProvider';
import { UploadDetailPanel } from '@/features/upload-detail/UploadDetailPanel';
import { ProductList } from './ProductList';
import { YourUploads } from './YourUploads';

/**
 * Routes / and /uploads/:id: where files come in, your own uploads still under way (private to
 * you), and everyone's finished products, with the open upload in a panel beside them.
 */
export function UploadsPage() {
  const { pending, addFiles, retry, dismiss } = useFileUploadsContext();
  return (
    // Full height: the lists and the detail panel each scroll on their own.
    // @container: the detail panel sizes itself as a share of this row's width.
    <div className="@container flex min-h-0 flex-1">
      {/* The scrollbar's space is always reserved, on both sides so the centred content stays
          centred: a list growing past the fold mustn't make everything shift sideways. */}
      <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        <div className="mx-auto grid max-w-4xl content-start gap-4 p-6">
          <Dropzone onSubmit={addFiles} />
          <YourUploads pending={pending} onRetry={retry} onDismiss={dismiss} />
          <ProductList />
        </div>
      </div>
      <UploadDetailPanel />
    </div>
  );
}
