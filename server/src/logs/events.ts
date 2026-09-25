import {
  formatBytes,
  SUPPORTED_FILE_TYPES,
  SUPPORTED_TYPES_LABEL,
  uploadErrorMessage,
  type SupportedMimeType,
  type UploadErrorCode,
} from '@label-extractor/shared';
import { isRetryableCode } from '../extraction/errors.ts';
import type { FiringAlert } from '../ops/store.ts';
import { MAX_EXTRACTION_ATTEMPTS } from '../uploads/jobs.ts';
import type { UploadRecord } from '../uploads/store.ts';
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
const attemptOf = (attempt: number) => `attempt ${attempt} of ${MAX_EXTRACTION_ATTEMPTS}`;
const fileTypeLabel = (mimeType: SupportedMimeType) => SUPPORTED_FILE_TYPES[mimeType].label;

export const logEvents = {
  // ---- The API, as an upload arrives -------------------------------------------------------

  uploadCreated(upload: UploadRecord): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      level: 'info',
      type: 'upload.created',
      message: `${upload.fileName} started uploading (${fileTypeLabel(upload.mimeType)}, ${formatBytes(upload.sizeBytes)}).`,
      data: { ...base.data, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes },
    };
  },

  /** Someone uploaded a file identical to `existing`, which was shown instead. */
  uploadDuplicate(existing: UploadRecord, fileName: string): NewLogEvent {
    return {
      uploadId: existing.id,
      level: 'info',
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
      level: 'info',
      type: 'upload.queued',
      message: `${upload.fileName} ${how}.${corrected}`,
      data: { ...base.data, mimeType: upload.mimeType, claimedType: options.claimedType, byFinaliseJob: options.byFinaliseJob },
    };
  },

  uploadRejected(upload: UploadRef): NewLogEvent {
    return {
      ...aboutUpload(upload),
      level: 'warn',
      type: 'upload.rejected',
      message: `${upload.fileName} isn't a supported file type (${SUPPORTED_TYPES_LABEL}), so it was deleted.`,
    };
  },

  uploadDiscarded(upload: UploadRef): NewLogEvent {
    return {
      ...aboutUpload(upload),
      level: 'info',
      type: 'upload.discarded',
      message: `${upload.fileName} never finished uploading, so it was discarded.`,
    };
  },

  retryRequested(upload: UploadRef): NewLogEvent {
    return {
      ...aboutUpload(upload),
      level: 'info',
      type: 'upload.retry_requested',
      message: `Extraction of ${upload.fileName} was requested again.`,
    };
  },

  // ---- The worker, extracting -------------------------------------------------------------

  extractionStarted(upload: UploadRecord): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      level: 'info',
      type: 'extraction.started',
      message: upload.attempts > 1 ? `Reading ${upload.fileName}, ${attemptOf(upload.attempts)}.` : `Reading ${upload.fileName}.`,
      data: { ...base.data, attempt: upload.attempts },
    };
  },

  /** `reusedFrom`: an identical file whose result was reused instead of asking the AI again. */
  extractionCompleted(
    upload: UploadRecord,
    details: { productName: string | null; durationMs?: number; reusedFrom?: string },
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
      level: 'info',
      type: 'extraction.completed',
      message: `${upload.fileName} ${how}${found}.`,
      data: { ...base.data, attempt: upload.attempts, ...details },
    };
  },

  retryScheduled(upload: UploadRecord, code: UploadErrorCode): NewLogEvent {
    const base = aboutUpload(upload);
    return {
      ...base,
      level: 'warn',
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
      level: 'error',
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
      level: 'error',
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
      level: 'warn',
      type: 'ratelimit.paused',
      message: `The AI service asked us to slow down while reading ${upload.fileName}. All AI requests paused for ${seconds(pauseMs)}.`,
      data: { ...base.data, pauseMs },
    };
  },

  // ---- The monitor ---------------------------------------------------------------------

  alertOpened(alert: FiringAlert): NewLogEvent {
    return {
      level: alert.severity === 'critical' ? 'error' : 'warn',
      type: 'alert.opened',
      message: `${alert.title}. ${alert.message}`,
      data: { key: alert.key, severity: alert.severity },
    };
  },

  alertResolved(alert: { key: string; title: string }): NewLogEvent {
    return {
      level: 'info',
      type: 'alert.resolved',
      message: `Resolved: ${alert.title}.`,
      data: { key: alert.key },
    };
  },

  // ---- Either process ------------------------------------------------------------------

  processStarted(name: 'API' | 'Worker', details: Record<string, unknown> = {}): NewLogEvent {
    return { level: 'info', type: 'process.started', message: `${name} started.`, data: details };
  },
};
