import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  canRetryUpload,
  createUploadRequestSchema,
  SUPPORTED_FILE_TYPES,
  SUPPORTED_TYPES_LABEL,
  validateFileMetadata,
  type CreateUploadResponse,
  listUploadsQuerySchema,
  UPLOAD_FILTERS,
  UPLOAD_FILTER_IDS,
  type ListUploadsResponse,
  type UploadCountsResponse,
  type UploadResponse,
} from '@label-extractor/shared';
import type { FileStorage } from '../../infra/storage.ts';
import { finaliseUpload } from '../../uploads/finalise.ts';
import { toUploadDetail, toUploadSummary } from '../../uploads/presenter.ts';
import type { UploadRecord, UploadStore } from '../../uploads/store.ts';
import { ApiError, notFound } from '../errors.ts';

export interface UploadRoutesDeps {
  uploads: UploadStore;
  storage: FileStorage;
}

/** How long preview links in the detail view stay valid. */
const PREVIEW_URL_TTL_SECONDS = 10 * 60;

const idParams = z.object({ id: z.uuid() });

/**
 * Upload endpoints. The upload flow is three requests from the browser:
 *
 *   1. POST /api/uploads              → validate metadata, create row, return a signed upload URL
 *   2. PUT  <signed URL>              → browser sends the bytes straight to storage (not via us)
 *   3. POST /api/uploads/:id/complete → verify the bytes, then queue the extraction job
 */
export async function uploadRoutes(app: FastifyInstance, { uploads, storage }: UploadRoutesDeps) {
  /** Loads an upload by the `:id` route param, or throws 404 (including for malformed IDs). */
  async function loadUpload(params: unknown): Promise<UploadRecord> {
    const parsed = idParams.safeParse(params);
    const upload = parsed.success ? await uploads.findById(parsed.data.id) : null;
    if (!upload) throw notFound();
    return upload;
  }

  /** Detail response, with a short-lived preview link. A storage hiccup shouldn't hide the data. */
  async function detailResponse(upload: UploadRecord): Promise<UploadResponse> {
    if (upload.resultUnreadable) {
      app.log.warn({ uploadId: upload.id }, 'Stored result no longer matches the extraction schema');
    }
    let fileUrl: string | null = null;
    if (upload.status !== 'uploading') {
      fileUrl = await storage.createDownloadUrl(upload.storagePath, PREVIEW_URL_TTL_SECONDS).catch((err: unknown) => {
        app.log.warn({ err, uploadId: upload.id }, 'Could not create preview URL');
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

    // Same rules the browser already applied — the browser can't be trusted to have done so.
    const validation = validateFileMetadata({
      name: body.data.fileName,
      type: body.data.mimeType,
      size: body.data.sizeBytes,
    });
    if (!validation.ok) throw new ApiError(422, validation.code, validation.message);

    // Already have this exact file (queued, processing or done)? Point at it instead of uploading
    // and extracting it again. The hash is the browser's claim; the worker checks the real bytes.
    if (body.data.sha256) {
      const existing = await uploads.findByContentHash(body.data.sha256);
      if (existing) return { kind: 'duplicate', upload: toUploadSummary(existing) };
    }

    // The object key is ours, never the user's file name: no path tricks, no unicode surprises.
    const id = crypto.randomUUID();
    const storagePath = `${new Date().toISOString().slice(0, 10)}/${id}${SUPPORTED_FILE_TYPES[validation.mimeType].extensions[0]}`;

    // Get the URL before inserting, so a storage outage doesn't leave an orphaned row behind.
    const uploadUrl = await storage.createUploadUrl(storagePath);
    const upload = await uploads.create({
      id,
      fileName: body.data.fileName.trim(),
      mimeType: validation.mimeType,
      sizeBytes: body.data.sizeBytes,
      storagePath,
      contentSha256: body.data.sha256 ?? null,
    });

    reply.status(201);
    return { kind: 'created', upload: toUploadSummary(upload), uploadUrl };
  });

  // 3. Confirm the upload finished ---------------------------------------------------------------
  app.post('/api/uploads/:id/complete', async (request): Promise<UploadResponse> => {
    const { id } = await loadUpload(request.params);
    const result = await finaliseUpload({ uploads, storage }, id);

    switch (result.outcome) {
      case 'queued':
      case 'already-finalised': // idempotent: a repeated confirmation just returns the state
        return detailResponse(result.upload);
      case 'not-uploaded':
        // Left as it is: the browser may retry the upload, and the finalise job settles it if not.
        throw new ApiError(409, 'FILE_NOT_UPLOADED', "We didn't receive the file. Please try uploading it again.");
      case 'rejected':
        // Nothing is kept — the browser shows this on the file's row, with the option to try again.
        throw new ApiError(422, 'FILE_CONTENT_MISMATCH', `Unsupported file type. Must be ${SUPPORTED_TYPES_LABEL}.`);
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
    const byStatus = await uploads.countByStatus();
    const count = (statuses: readonly string[]) => statuses.reduce((sum, s) => sum + (byStatus[s as keyof typeof byStatus] ?? 0), 0);
    return {
      counts: Object.fromEntries(UPLOAD_FILTER_IDS.map((id) => [id, count(UPLOAD_FILTERS[id])])) as UploadCountsResponse['counts'],
    };
  });

  app.get('/api/uploads/:id', async (request): Promise<UploadResponse> => {
    return detailResponse(await loadUpload(request.params));
  });

  // Manual retry of a failed upload ------------------------------------------------------------
  app.post('/api/uploads/:id/retry', async (request): Promise<UploadResponse> => {
    const upload = await loadUpload(request.params);
    if (!canRetryUpload(upload)) {
      throw new ApiError(
        409,
        'NOT_RETRYABLE',
        upload.status === 'failed'
          ? "This file can't be processed. Please upload a different file."
          : 'Only failed uploads, or completed ones whose result can no longer be read, can be run again.',
      );
    }
    const requeued = await uploads.requeue(upload.id, upload.status === 'completed' ? 'completed' : 'failed');
    return detailResponse(requeued ?? (await loadUpload(request.params)));
  });
}
