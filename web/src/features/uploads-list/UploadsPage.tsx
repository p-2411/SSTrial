import { useFileUploadsContext } from '@/features/upload/FileUploadsProvider';
import { UploadDetailPanel } from '@/features/upload-detail/UploadDetailPanel';
import { ProductList } from './ProductList';
import { ReviewStage } from './ReviewStage';
import { UploadStage } from './UploadStage';

/**
 * Routes / and /uploads/:id: the three stages a label goes through, with the open upload in a
 * panel beside them. Upload, where files come in and are read; Review, where the person checks
 * what was read and submits it; and Products, everyone's. The first two are private to the person.
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
          <UploadStage pending={pending} onUpload={addFiles} onRetry={retry} onDismiss={dismiss} />
          <ReviewStage />
          <ProductList />
        </div>
      </div>
      <UploadDetailPanel />
    </div>
  );
}
