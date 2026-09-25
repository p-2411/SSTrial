import { Dropzone } from '@/features/upload/Dropzone';
import { useFileUploadsContext } from '@/features/upload/FileUploadsProvider';
import { PendingUploadRow } from '@/features/upload/PendingUploadRow';
import { UploadDetailPanel } from '@/features/upload-detail/UploadDetailPanel';
import { UploadList } from './UploadList';

/**
 * Routes / and /uploads/:id: the dropzone and list, with the open upload in a panel beside them.
 * Files still being sent from this browser lead the list.
 */
export function UploadsPage() {
  const { pending, addFiles, retry, dismiss } = useFileUploadsContext();
  return (
    // Full height: the list and the detail panel each scroll on their own.
    // @container: the detail panel sizes itself as a share of this row's width.
    <div className="@container flex min-h-0 flex-1">
      {/* The scrollbar's space is always reserved, on both sides so the centred content stays
          centred: switching to a short filter mustn't make everything shift sideways. */}
      <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        <div className="mx-auto grid max-w-4xl content-start gap-4 p-6">
          <Dropzone onFiles={addFiles} />
          <UploadList
            leadingRows={pending.map((upload) => (
              <PendingUploadRow key={upload.localId} upload={upload} onRetry={retry} onDismiss={dismiss} />
            ))}
          />
        </div>
      </div>
      <UploadDetailPanel />
    </div>
  );
}
