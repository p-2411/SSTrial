import {
  FIELD_LABELS,
  formatList,
  formatBytes,
  SUPPORTED_FILE_TYPES,
  SUPPORTED_TYPES_LABEL,
  uploadErrorMessage,
  type LabelField,
  type SupportedMimeType,
  type UploadErrorCode,
} from '@label-extractor/shared';
import { isRetryableCode, RETRY_POLICY } from '../extraction/retry-policy.ts';
import type { UploadRecord, UploadVersion } from '../uploads/store.ts';
import type { NewLogEvent } from './store.ts';

/**
 * Every event the app records, built in one place so their wording and details stay consistent.
 * Messages are written for the Logs page: one plain sentence, naming the file. `data` carries the
 * same facts in structured form (and the file name, so it's still known after an upload is deleted).
 */

type UploadRef = Pick<UploadRecord, 'id' | 'fileName'>;

/** The fields every upload event carries. */
function aboutUpload(upload: UploadRef) {
  return { uploadId: upload.id, data: { fileName: upload.fileName } };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const attemptOf = (attempt: number) => `attempt ${attempt} of ${RETRY_POLICY.maxAttempts}`;
const fileTypeLabel = (mimeType: SupportedMimeType) => SUPPORTED_FILE_TYPES[mimeType].label;
/** ['brand', 'netWeight'] → "brand and net weight". */
const fieldList = (fields: LabelField[]) => formatList(fields.map((field) => FIELD_LABELS[field].toLowerCase()), 'and');

export const logEvents = {
  // ---- The API, as an upload arrives -------------------------------------------------------

  uploadCreated(upload: UploadRecord, by: string): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      type: 'upload.created',
      message: `${by} started uploading ${upload.fileName} (${fileTypeLabel(upload.mimeType)}, ${formatBytes(upload.sizeBytes)}).`,
      data: { ...base.data, by, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes },
    };
  },

  /** Someone uploaded a file identical to `existing`, which was shown instead. */
  uploadDuplicate(existing: UploadRecord, fileName: string): NewLogEvent {
    return {
      uploadId: existing.id,
      type: 'upload.duplicate',
      message: `${fileName} is identical to ${existing.fileName}, which was shown instead of processing it again.`,
      data: { fileName, existingFileName: existing.fileName },
    };
  },

  /** The file arrived and checked out. `claimedType` is what the browser said it was. */
  uploadQueued(upload: UploadRecord, options: { byFinaliseJob: boolean; claimedType: SupportedMimeType }): NewLogEvent {
    const base = aboutUpload(upload);
    const how = options.byFinaliseJob
      ? 'arrived without the browser confirming it, and was queued for extraction'
      : 'arrived and was queued for extraction';
    const corrected =
      options.claimedType === upload.mimeType
        ? ''
        : ` It was sent as a ${fileTypeLabel(options.claimedType)} but is a ${fileTypeLabel(upload.mimeType)}, and was accepted as one.`;
    return {
      ...base,
      type: 'upload.queued',
      message: `${upload.fileName} ${how}.${corrected}`,
      data: { ...base.data, mimeType: upload.mimeType, claimedType: options.claimedType, byFinaliseJob: options.byFinaliseJob },
    };
  },

  uploadRejected(upload: UploadRef): NewLogEvent {
    return {
      ...aboutUpload(upload),
      type: 'upload.rejected',
      message: `${upload.fileName} isn't a supported file type (${SUPPORTED_TYPES_LABEL}), so it was deleted.`,
    };
  },

  uploadDiscarded(upload: UploadRef): NewLogEvent {
    return {
      ...aboutUpload(upload),
      type: 'upload.discarded',
      message: `${upload.fileName} never finished uploading, so it was discarded.`,
    };
  },

  retryRequested(upload: UploadRef, by: string): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      type: 'upload.retry_requested',
      message: `${by} asked for ${upload.fileName} to be read again.`,
      data: { ...base.data, by },
    };
  },

  /** Someone corrected fields (`changes`, with before and after) and/or confirmed others (`checked`). */
  resultEdited(
    upload: UploadRef,
    review: {
      by: string;
      changes: Partial<Record<LabelField, { from: unknown; to: unknown }>>;
      checked: LabelField[];
      /** The data after this review, as saved: what "Revert to here" goes back to. */
      versionId: string;
    },
  ): NewLogEvent {
    const base = aboutUpload(upload);
    const edited = Object.keys(review.changes) as LabelField[];
    const phrases = [
      edited.length > 0 && `changed the ${fieldList(edited)}`,
      review.checked.length > 0 && `confirmed the ${fieldList(review.checked)}`,
    ].filter(Boolean);
    return {
      ...base,
      type: 'upload.edited',
      message: `${review.by} ${phrases.join(' and ')} of ${upload.fileName}.`,
      data: { ...base.data, by: review.by, changes: review.changes, checked: review.checked, versionId: review.versionId },
    };
  },

  /** An admin put the data back to an earlier version (`to`); the result is saved as `versionId`. */
  uploadReverted(upload: UploadRef, revert: { by: string; to: UploadVersion; versionId: string }): NewLogEvent {
    const base = aboutUpload(upload);
    const back = { extraction: "the AI's reading", review: 'how it was after an earlier review', revert: 'an earlier version' }[revert.to.source];
    return {
      ...base,
      type: 'upload.reverted',
      message: `${revert.by} put ${upload.fileName} back to ${back}.`,
      data: { ...base.data, by: revert.by, revertedTo: revert.to.id, versionId: revert.versionId },
    };
  },

  uploadDeleted(upload: UploadRef, by: string): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      type: 'upload.deleted',
      message: `${by} deleted ${upload.fileName}.`,
      data: { ...base.data, by },
    };
  },

  // ---- The worker, extracting -------------------------------------------------------------

  extractionStarted(upload: UploadRecord): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      type: 'extraction.started',
      message: upload.attempts > 1 ? `Reading ${upload.fileName}, ${attemptOf(upload.attempts)}.` : `Reading ${upload.fileName}.`,
      data: { ...base.data, attempt: upload.attempts },
    };
  },

  /** `reusedFrom`: an identical file whose result was reused instead of asking the AI again. */
  /** `versionId`: the reading as saved, which an admin can put the data back to (see uploads/revert.ts). */
  extractionCompleted(
    upload: UploadRecord,
    details: { productName: string | null; versionId: string; durationMs?: number; reusedFrom?: string },
  ): NewLogEvent {
    const base = aboutUpload(upload);
    const found = details.productName ? `: ${details.productName}` : '';
    const how = details.reusedFrom
      ? 'reused the result of an identical file'
      : details.durationMs === undefined
        ? 'read'
        : `read in ${seconds(details.durationMs)}`;
    return {
      ...base,
      type: 'extraction.completed',
      message: `${upload.fileName} ${how}${found}.`,
      data: { ...base.data, attempt: upload.attempts, ...details },
    };
  },

  retryScheduled(upload: UploadRecord, code: UploadErrorCode): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      type: 'extraction.retry_scheduled',
      message: `${upload.fileName} failed on ${attemptOf(upload.attempts)}: ${uploadErrorMessage(code)} It will be retried.`,
      data: { ...base.data, code, attempt: upload.attempts },
    };
  },

  extractionFailed(upload: UploadRecord, code: UploadErrorCode): NewLogEvent {
    const base = aboutUpload(upload);
    // Say whether it was given up on or never worth retrying: the difference matters when reading a log.
    const why = isRetryableCode(code) ? ` Gave up after ${upload.attempts} attempts.` : " Retrying wouldn't help.";
    return {
      ...base,
      type: 'extraction.failed',
      message: `${upload.fileName} failed: ${uploadErrorMessage(code)}${why}`,
      data: { ...base.data, code, attempt: upload.attempts },
    };
  },

  /** The dead-letter safety net failed an upload that every attempt died on. */
  extractionAbandoned(upload: UploadRecord, code: UploadErrorCode): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      type: 'extraction.abandoned',
      message: `Every attempt on ${upload.fileName} stopped before finishing (crashed or hung), so it was marked failed.`,
      data: { ...base.data, code, attempts: upload.attempts },
    };
  },

  /** The provider asked us to back off while `upload` was being read; every worker paused. */
  rateLimitPaused(upload: UploadRef, pauseMs: number): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      type: 'ratelimit.paused',
      message: `The AI service asked us to slow down while reading ${upload.fileName}. All AI requests paused for ${seconds(pauseMs)}.`,
      data: { ...base.data, pauseMs },
    };
  },

  // ---- Either process ------------------------------------------------------------------

  processStarted(name: 'API' | 'Worker', details: Record<string, unknown> = {}): NewLogEvent {
    return { type: 'process.started', message: `${name} started.`, data: details };
  },
};
