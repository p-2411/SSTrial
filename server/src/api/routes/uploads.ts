import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createUploadRequestSchema,
  listUploadsQuerySchema,
  SUPPORTED_TYPES_LABEL,
  UPLOAD_FILTER_IDS,
  UPLOAD_FILTERS,
  type CreateUploadResponse,
  type ListUploadsResponse,
  type UploadCountsResponse,
  type UploadResponse,
} from '@label-extractor/shared';
import type { FileStorage } from '../../infra/storage.ts';
import type { EventLog } from '../../logs/store.ts';
import { finaliseUpload } from '../../uploads/finalise.ts';
import { requestUpload } from '../../uploads/intake.ts';
import { toUploadCounts, toUploadDetail, toUploadSummary } from '../../uploads/presenter.ts';
import { retryUpload } from '../../uploads/retry.ts';
import type { UploadIntake, UploadQueries, UploadRecord } from '../../uploads/store.ts';
import { ApiError, notFound } from '../errors.ts';

export interface UploadRoutesDeps {
  uploads: UploadQueries & UploadIntake;
  storage: FileStorage;
  /** The use cases record what they did to the activity log. */
  events: EventLog;
}

/** How long preview links in the detail view stay valid. */
const PREVIEW_URL_TTL_SECONDS = 10 * 60;

const idParams = z.object({ id: z.uuid() });

/**
 * Upload endpoints: HTTP in, HTTP out. What each step does lives in uploads/ (intake, finalise,
 * retry); these handlers parse the request and turn the outcome into a response. The upload flow is
 * three requests from the browser:
 *
 *   1. POST /api/uploads              → validate metadata, create row, return a signed upload URL
 *   2. PUT  <signed URL>              → browser sends the bytes straight to storage (not via us)
 *   3. POST /api/uploads/:id/complete → verify the bytes, then queue the extraction job
 */
export async function uploadRoutes(app: FastifyInstance, { uploads, storage, events }: UploadRoutesDeps) {
  /** The `:id` route param, or a 404 for a malformed ID (it can't name an upload). */
  function uploadId(params: unknown): string {
    const parsed = idParams.safeParse(params);
    if (!parsed.success) throw notFound();
    return parsed.data.id;
  }

  /** Detail response, with a short-lived preview link. A storage hiccup shouldn't hide the data. */
  async function detailResponse(upload: UploadRecord, log: FastifyBaseLogger): Promise<UploadResponse> {
    if (upload.resultUnreadable) {
      log.warn({ uploadId: upload.id }, 'Stored result no longer matches the extraction schema');
    }
    let fileUrl: string | null = null;
    if (upload.status !== 'uploading') {
      fileUrl = await storage.createDownloadUrl(upload.storagePath, PREVIEW_URL_TTL_SECONDS).catch((err: unknown) => {
        log.warn({ err, uploadId: upload.id }, 'Could not create preview URL');
        return null;
      });
    }
    return { upload: toUploadDetail(upload, fileUrl) };
  }

  // 1. Ask to upload a file ------------------------------------------------------------------
  app.post('/api/uploads', async (request, reply): Promise<CreateUploadResponse> => {
    const body = createUploadRequestSchema.safeParse(request.body);
    if (!body.success) {
      throw new ApiError(400, 'BAD_REQUEST', 'Expected a JSON body with fileName, mimeType and sizeBytes.');
    }
    const result = await requestUpload({ uploads, storage, events }, body.data);

    switch (result.outcome) {
      case 'invalid':
        throw new ApiError(422, result.code, result.message);
      case 'duplicate':
        return { kind: 'duplicate', upload: toUploadSummary(result.upload) };
      case 'created':
        reply.status(201);
        return { kind: 'created', upload: toUploadSummary(result.upload), uploadUrl: result.uploadUrl };
    }
  });

  // 3. Confirm the upload finished ---------------------------------------------------------------
  app.post('/api/uploads/:id/complete', async (request): Promise<UploadResponse> => {
    const result = await finaliseUpload({ uploads, storage, events }, uploadId(request.params), { caller: 'browser' });

    switch (result.outcome) {
      case 'queued':
      case 'already-finalised': // idempotent: a repeated confirmation just returns the state
        return detailResponse(result.upload, request.log);
      case 'not-uploaded':
        // Left as it is: the browser may retry the upload, and the finalise job settles it if not.
        throw new ApiError(409, 'FILE_NOT_UPLOADED', "We didn't receive the file. Please try uploading it again.");
      case 'rejected':
        // Nothing is kept — the browser shows this on the file's row, with the option to try again.
        throw new ApiError(422, 'FILE_CONTENT_MISMATCH', `Unsupported file type. Must be ${SUPPORTED_TYPES_LABEL}.`);
      case 'discarded': // only the finalise job discards, but either way the upload is gone
      case 'not-found':
        throw notFound();
    }
  });

  // List & detail -------------------------------------------------------------------------
  app.get('/api/uploads', async (request): Promise<ListUploadsResponse> => {
    const query = listUploadsQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ApiError(400, 'BAD_REQUEST', `Use status=${UPLOAD_FILTER_IDS.join('|')}, a cursor from a previous page, and limit=1–100.`);
    }
    const { status, cursor, limit } = query.data;
    // Ask for one extra row: if it comes back, there's another page after this one.
    const records = await uploads.list({ statuses: UPLOAD_FILTERS[status], limit: limit + 1, after: cursor });
    const page = records.slice(0, limit);
    return {
      uploads: page.map(toUploadSummary),
      nextCursor: records.length > limit ? page.at(-1)!.id : null,
    };
  });

  app.get('/api/uploads/counts', async (): Promise<UploadCountsResponse> => {
    return toUploadCounts(await uploads.countByStatus());
  });

  app.get('/api/uploads/:id', async (request): Promise<UploadResponse> => {
    const upload = await uploads.findById(uploadId(request.params));
    if (!upload) throw notFound();
    return detailResponse(upload, request.log);
  });

  // Manual retry of a failed upload ------------------------------------------------------------
  app.post('/api/uploads/:id/retry', async (request): Promise<UploadResponse> => {
    const result = await retryUpload({ uploads, events }, uploadId(request.params));

    switch (result.outcome) {
      case 'requeued':
        return detailResponse(result.upload, request.log);
      case 'not-retryable':
        throw new ApiError(
          409,
          'NOT_RETRYABLE',
          result.upload.status === 'failed'
            ? "This file can't be processed. Please upload a different file."
            : 'Only failed uploads, or completed ones whose result can no longer be read, can be run again.',
        );
      case 'not-found':
        throw notFound();
    }
  });
}
