import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createUploadRequestSchema,
  editResultRequestSchema,
  listUploadsQuerySchema,
  uploadHistoryQuerySchema,
  revertRequestSchema,
  uploadIdsRequestSchema,
  MAX_OPEN_UPLOADS_PER_PERSON,
  MAX_SEARCH_LENGTH,
  MAX_UPLOADS_PER_REQUEST,
  PAGE_SIZES,
  SUPPORTED_TYPES_LABEL,
  uploadCursor,
  UPLOAD_VIEW_IDS,
  UPLOAD_VIEWS,
  type CheckUploadsResponse,
  type CreateUploadResponse,
  type DeleteUploadsResponse,
  type ListUploadsResponse,
  type SubmitUploadsResponse,
  type UploadResponse,
  type EventDetails,
  type UploadHistoryResponse,
} from '@label-extractor/shared';
import type { MemberStore } from '../../auth/members.ts';
import type { FileStorage } from '../../infra/storage.ts';
import type { EventLog, EventQueries } from '../../logs/store.ts';
import { findVisible } from '../../uploads/access.ts';
import { editResult } from '../../uploads/edit.ts';
import { finaliseUpload } from '../../uploads/finalise.ts';
import { requestUpload } from '../../uploads/intake.ts';
import { loadUploadDetail } from '../../uploads/detail.ts';
import { toUploadSummary } from '../../uploads/presenter.ts';
import { checkFlaggedFields } from '../../uploads/check.ts';
import { submitUploads } from '../../uploads/submit.ts';
import { loadHistoryDetails, loadUploadHistory } from '../../uploads/history.ts';
import { retryUpload } from '../../uploads/retry.ts';
import { revertUpload } from '../../uploads/revert.ts';
import { deleteUpload } from '../../uploads/delete.ts';
import type { UploadIntake, UploadQueries, UploadRecord, UploadRemoval, UploadReviews, UploadVersions } from '../../uploads/store.ts';
import { ApiError, notFound } from '../errors.ts';
import { ACTIVITY_QUERY_HELP, pageOf, wordsAndTime } from '../paging.ts';
import { eventIdParam, uploadIdParam } from '../params.ts';

export interface UploadRoutesDeps {
  uploads: UploadQueries & UploadVersions & UploadIntake & UploadReviews & UploadRemoval;
  storage: FileStorage;
  /** The use cases record what they did to the activity log; each upload's history reads it back. */
  events: EventLog & EventQueries;
  /** To name who uploaded each file, and who reviewed its fields. */
  members: Pick<MemberStore, 'emailsOf'>;
}

/**
 * Upload endpoints: HTTP in, HTTP out. What each step does lives in uploads/ (intake, finalise,
 * edit, check, submit, retry, revert, delete, detail, history); these handlers parse the request
 * and turn the outcome into a response. Every route that names an upload answers 404 to anyone who
 * can't see it, before anything else (see uploads/access.ts). The upload flow is three requests
 * from the browser:
 *
 *   1. POST /api/uploads              → validate metadata, create row, return a signed upload URL
 *   2. PUT  <signed URL>              → browser sends the bytes straight to storage (not via us)
 *   3. POST /api/uploads/:id/complete → verify the bytes, then queue the extraction job
 */
export async function uploadRoutes(app: FastifyInstance, { uploads, storage, events, members }: UploadRoutesDeps) {
  function uploadIds(body: unknown) {
    const parsed = uploadIdsRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', `Expected { ids } with 1–${MAX_UPLOADS_PER_REQUEST} upload IDs.`);
    return parsed.data;
  }

  async function detailResponse(upload: UploadRecord, request: FastifyRequest): Promise<UploadResponse> {
    return { upload: await loadUploadDetail({ storage, members, log: request.log, viewer: request.member! }, upload) };
  }

  // 1. Ask to upload a file ------------------------------------------------------------------
  app.post('/api/uploads', async (request, reply): Promise<CreateUploadResponse> => {
    const body = createUploadRequestSchema.safeParse(request.body);
    if (!body.success) {
      throw new ApiError(400, 'BAD_REQUEST', 'Expected a JSON body with fileName, mimeType and sizeBytes.');
    }
    const result = await requestUpload({ uploads, storage, events }, body.data, request.member!);

    switch (result.outcome) {
      case 'invalid':
        throw new ApiError(422, result.code, result.message);
      case 'too-many':
        throw new ApiError(
          429,
          'TOO_MANY_UPLOADS',
          `You have ${MAX_OPEN_UPLOADS_PER_PERSON} uploads under way. Wait for some to finish, then try again.`,
        );
      case 'duplicate':
        return { kind: 'duplicate', upload: toUploadSummary(result.upload) };
      case 'created':
        reply.status(201);
        return { kind: 'created', upload: toUploadSummary(result.upload), uploadUrl: result.uploadUrl };
    }
  });

  // 3. Confirm the upload finished ---------------------------------------------------------------
  app.post('/api/uploads/:id/complete', async (request): Promise<UploadResponse> => {
    const result = await finaliseUpload({ uploads, storage, events }, uploadIdParam(request.params), {
      caller: 'browser',
      person: request.member!,
    });

    switch (result.outcome) {
      case 'queued':
      case 'already-finalised': // idempotent: a repeated confirmation just returns the state
        return detailResponse(result.upload, request);
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
  // Three views, one per stage: the asker's own uploads being read (or failed), their own read
  // uploads waiting for review, and everyone's products.
  app.get('/api/uploads', async (request): Promise<ListUploadsResponse> => {
    const query = listUploadsQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ApiError(
        400,
        'BAD_REQUEST',
        `Use view=${UPLOAD_VIEW_IDS.join('|')}, q=words (up to ${MAX_SEARCH_LENGTH} characters), from= and to= as ISO date-times, a cursor from a previous page, and limit=1–${PAGE_SIZES.uploads.max}.`,
      );
    }
    const { view, cursor, limit } = query.data;
    const { statuses, submitted, own } = UPLOAD_VIEWS[view];
    const records = await uploads.list({
      statuses,
      submitted: submitted ?? undefined,
      uploadedBy: own ? request.member!.id : undefined,
      ...wordsAndTime(query.data),
      limit: limit + 1,
      after: cursor,
    });
    const { page, nextCursor } = pageOf(records, limit, (upload) => uploadCursor(upload.cursor));
    return { uploads: page.map(toUploadSummary), nextCursor };
  });

  app.get('/api/uploads/:id', async (request): Promise<UploadResponse> => {
    const upload = await findVisible(uploads, uploadIdParam(request.params), request.member!);
    if (!upload) throw notFound();
    return detailResponse(upload, request);
  });

  // People correcting or confirming the extracted data ----------------------------------------
  app.patch('/api/uploads/:id/result', async (request): Promise<UploadResponse> => {
    const id = uploadIdParam(request.params);
    const body = editResultRequestSchema.safeParse(request.body);
    if (!body.success) {
      throw new ApiError(400, 'BAD_REQUEST', 'Expected { revision, changes?, checked? } with known fields.');
    }
    const result = await editResult({ uploads, events }, id, body.data, request.member!);

    switch (result.outcome) {
      case 'saved':
        return detailResponse(result.upload, request);
      case 'invalid':
        throw new ApiError(422, 'INVALID_EDIT', result.message);
      case 'conflict':
        throw new ApiError(409, 'EDIT_CONFLICT', 'Someone else changed this upload since you opened it.');
      case 'not-editable':
        throw new ApiError(409, 'NOT_EDITABLE', 'Only completed uploads with readable data can be edited.');
      case 'not-found':
        throw notFound();
    }
  });

  // Review: checking flagged fields in bulk, and submitting to Products ------------------------
  // Each acts on the uploads named that it can, and says which those were (see check.ts, submit.ts).
  app.post('/api/uploads/check', async (request): Promise<CheckUploadsResponse> => {
    const { ids } = uploadIds(request.body);
    const checked = await checkFlaggedFields({ uploads, events }, ids, request.member!);
    return { checked: checked.map((upload) => upload.id) };
  });

  // Deleting several at once: each as DELETE /api/uploads/:id would, skipping any the asker may not.
  app.post('/api/uploads/delete', async (request): Promise<DeleteUploadsResponse> => {
    const { ids } = uploadIds(request.body);
    const deleted: string[] = [];
    for (const id of new Set(ids)) {
      const result = await deleteUpload({ uploads, storage, events }, id, request.member!);
      if (result.outcome === 'deleted') deleted.push(id);
    }
    return { deleted };
  });

  app.post('/api/uploads/submit', async (request): Promise<SubmitUploadsResponse> => {
    const { ids } = uploadIds(request.body);
    const submitted = await submitUploads({ uploads, events }, ids, request.member!);
    return { submitted: submitted.map((upload) => upload.id) };
  });

  // One upload's history, for its detail. Newest first, a page at a time, searched and filtered
  // like the activity log.
  app.get('/api/uploads/:id/history', async (request): Promise<UploadHistoryResponse> => {
    const id = uploadIdParam(request.params);
    const query = uploadHistoryQuerySchema.safeParse(request.query);
    if (!query.success) throw new ApiError(400, 'BAD_REQUEST', `${ACTIVITY_QUERY_HELP}, and limit=1–${PAGE_SIZES.history.max}.`);
    const { type, cursor, limit } = query.data;
    const filters = { types: type, ...wordsAndTime(query.data), limit: limit + 1, after: cursor };
    const entries = await loadUploadHistory({ uploads, events }, id, filters, request.member!);
    if (!entries) throw notFound();
    const { page, nextCursor } = pageOf(entries, limit, (entry) => entry.id);
    return { entries: page, nextCursor };
  });

  app.get('/api/uploads/:id/history/:eventId', async (request): Promise<EventDetails> => {
    const result = await loadHistoryDetails({ uploads, events }, uploadIdParam(request.params), eventIdParam(request.params), request.member!);
    switch (result.outcome) {
      case 'found':
        return result.details;
      case 'no-upload':
        throw notFound();
      case 'no-event':
        throw notFound('Event');
    }
  });

  // An admin putting a product's data back to an earlier version ------------------------------
  app.post('/api/uploads/:id/revert', async (request): Promise<UploadResponse> => {
    const id = uploadIdParam(request.params);
    const body = revertRequestSchema.safeParse(request.body);
    if (!body.success) throw new ApiError(400, 'BAD_REQUEST', 'Expected { revision, versionId }.');
    const result = await revertUpload({ uploads, events }, id, body.data, request.member!);

    switch (result.outcome) {
      case 'reverted':
        return detailResponse(result.upload, request);
      case 'conflict':
        throw new ApiError(409, 'EDIT_CONFLICT', 'Someone else changed this upload since you opened it.');
      case 'not-revertible':
        throw new ApiError(409, 'NOT_EDITABLE', 'Only a completed upload can be reverted.');
      case 'forbidden':
        throw new ApiError(403, 'FORBIDDEN', 'Only admins can put data back to an earlier version.');
      case 'not-found':
        throw notFound();
    }
  });

  // Manual retry of a failed upload ------------------------------------------------------------
  app.post('/api/uploads/:id/retry', async (request): Promise<UploadResponse> => {
    const result = await retryUpload({ uploads, events }, uploadIdParam(request.params), request.member!);

    switch (result.outcome) {
      case 'requeued':
        return detailResponse(result.upload, request);
      case 'forbidden':
        throw new ApiError(403, 'FORBIDDEN', 'Only the person who uploaded this, or an admin, can have it read again.');
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

  // Deleting an upload -------------------------------------------------------------------------
  app.delete('/api/uploads/:id', async (request, reply) => {
    const result = await deleteUpload({ uploads, storage, events }, uploadIdParam(request.params), request.member!);

    switch (result.outcome) {
      case 'deleted':
        return reply.status(204).send();
      case 'forbidden':
        throw new ApiError(403, 'FORBIDDEN', 'Only the person who uploaded this, or an admin, can delete it.');
      case 'not-found':
        throw notFound();
    }
  });
}
