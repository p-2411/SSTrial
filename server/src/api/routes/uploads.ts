import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  canRetryUpload,
  createUploadRequestSchema,
  SUPPORTED_FILE_TYPES,
  validateFileMetadata,
  type CreateUploadResponse,
  type ListUploadsResponse,
  type SupportedMimeType,
  type UploadResponse,
} from '@label-extractor/shared';
import { detectFileType, SIGNATURE_BYTES } from '../../infra/file-signature.ts';
import type { FileStorage } from '../../infra/storage.ts';
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
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

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
    });

    reply.status(201);
    return { upload: toUploadSummary(upload), uploadUrl };
  });

  // 3. Confirm the upload finished ---------------------------------------------------------------
  app.post('/api/uploads/:id/complete', async (request): Promise<UploadResponse> => {
    const upload = await loadUpload(request.params);

    // Idempotent: a repeated confirmation (network retry, double click) just returns the state.
    if (upload.status !== 'uploading') return detailResponse(upload);

    const head = await storage.readHead(upload.storagePath, SIGNATURE_BYTES);
    if (!head || head.length === 0) {
      throw new ApiError(409, 'FILE_NOT_UPLOADED', "We didn't receive the file. Please try uploading it again.");
    }

    // The name and MIME type were claims; the bytes are the truth.
    const detected = detectFileType(head);
    if (!detected) {
      const rejected = await uploads.rejectUpload(upload.id, 'FILE_CONTENT_MISMATCH');
      return detailResponse(rejected ?? (await loadUpload(request.params)));
    }
    if (detected !== upload.mimeType) {
      // e.g. a PNG saved as "label.jpg". The content is fine, so accept it under its real type.
      request.log.info({ uploadId: upload.id, claimed: upload.mimeType, detected }, 'Correcting mislabelled file type');
    }

    // Row → queued and job created in one transaction. Null means a concurrent request won.
    const queued = await uploads.markUploaded(upload.id, detected satisfies SupportedMimeType);
    return detailResponse(queued ?? (await loadUpload(request.params)));
  });

  // List & detail -------------------------------------------------------------------------
  app.get('/api/uploads', async (request): Promise<ListUploadsResponse> => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) throw new ApiError(400, 'BAD_REQUEST', 'limit must be a whole number from 1 to 200.');
    const records = await uploads.listRecent(query.data.limit);
    return { uploads: records.map(toUploadSummary) };
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
          : 'Only failed uploads can be retried.',
      );
    }
    const requeued = await uploads.requeueFailed(upload.id);
    return detailResponse(requeued ?? (await loadUpload(request.params)));
  });
}
