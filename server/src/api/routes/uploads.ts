import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  canViewUpload,
  createUploadRequestSchema,
  editResultRequestSchema,
  listUploadsQuerySchema,
  uploadHistoryQuerySchema,
  revertRequestSchema,
  uploadIdsRequestSchema,
  MAX_OPEN_UPLOADS_PER_PERSON,
  MAX_UPLOADS_PER_REQUEST,
  SUPPORTED_TYPES_LABEL,
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
import { eventDetails } from '../../logs/details.ts';
import type { EventLog, EventQueries } from '../../logs/store.ts';
import { editResult } from '../../uploads/edit.ts';
import { finaliseUpload } from '../../uploads/finalise.ts';
import { requestUpload } from '../../uploads/intake.ts';
import { loadUploadDetail } from '../../uploads/detail.ts';
import { toUploadSummary, visibilityOf } from '../../uploads/presenter.ts';
import { checkFlaggedFields } from '../../uploads/check.ts';
import { submitUploads } from '../../uploads/submit.ts';
import { toHistoryEntries } from '../../uploads/history.ts';
import { retryUpload } from '../../uploads/retry.ts';
import { revertUpload } from '../../uploads/revert.ts';
import { deleteUpload } from '../../uploads/delete.ts';
import type { UploadIntake, UploadQueries, UploadRecord, UploadRemoval, UploadReviews } from '../../uploads/store.ts';
import { requireRole } from '../auth.ts';
import { ACTIVITY_QUERY_HELP, eventId } from './logs.ts';
import { ApiError, notFound } from '../errors.ts';

export interface UploadRoutesDeps {
  uploads: UploadQueries & UploadIntake & UploadReviews & UploadRemoval;
  storage: FileStorage;
  /** The use cases record what they did to the activity log; each upload's history reads it back. */
  events: EventLog & EventQueries;
  /** To name who uploaded each file, and who reviewed its fields. */
  members: Pick<MemberStore, 'emailsOf'>;
}

const idParams = z.object({ id: z.uuid() });

/**
 * Upload endpoints: HTTP in, HTTP out. What each step does lives in uploads/ (intake, finalise,
 * edit, retry, delete, detail); these handlers parse the request and turn the outcome into a response. The upload flow is
 * three requests from the browser:
 *
 *   1. POST /api/uploads              → validate metadata, create row, return a signed upload URL
 *   2. PUT  <signed URL>              → browser sends the bytes straight to storage (not via us)
 *   3. POST /api/uploads/:id/complete → verify the bytes, then queue the extraction job
 */
export async function uploadRoutes(app: FastifyInstance, { uploads, storage, events, members }: UploadRoutesDeps) {
  /** The `:id` route param, or a 404 for a malformed ID (it can't name an upload). */
  function uploadId(params: unknown): string {
    const parsed = idParams.safeParse(params);
    if (!parsed.success) throw notFound();
    return parsed.data.id;
  }

  function uploadIds(body: unknown) {
    const parsed = uploadIdsRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', `Expected { ids } with 1–${MAX_UPLOADS_PER_REQUEST} upload IDs.`);
    return parsed.data;
  }

  async function detailResponse(upload: UploadRecord, request: FastifyRequest): Promise<UploadResponse> {
    return { upload: await loadUploadDetail({ storage, members, log: request.log, viewer: request.member! }, upload) };
  }

  /**
   * The upload named in the URL, if the person asking may see it (see canViewUpload); otherwise a
   * 404, the same as for one that doesn't exist, so someone else's unfinished upload stays private.
   */
  async function visibleUpload(request: FastifyRequest): Promise<UploadRecord> {
    const upload = await uploads.findById(uploadId(request.params));
    if (!upload || !canViewUpload(visibilityOf(upload), request.member!)) throw notFound();
    return upload;
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
    const result = await finaliseUpload({ uploads, storage, events }, uploadId(request.params), { caller: 'browser' });

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
        `Use view=${UPLOAD_VIEW_IDS.join('|')}, q=words (up to 200 characters), from= and to= as ISO date-times, a cursor from a previous page, and limit=1–100.`,
      );
    }
    const { view, q, from, to, cursor, limit } = query.data;
    const { statuses, submitted, own } = UPLOAD_VIEWS[view];
    // Ask for one extra row: if it comes back, there's another page after this one.
    const records = await uploads.list({
      statuses,
      submitted: submitted ?? undefined,
      uploadedBy: own ? request.member!.id : undefined,
      search: q || undefined,
      addedFrom: from ? new Date(from) : undefined,
      addedBefore: to ? new Date(to) : undefined,
      limit: limit + 1,
      after: cursor,
    });
    const page = records.slice(0, limit);
    return {
      uploads: page.map(toUploadSummary),
      nextCursor: records.length > limit ? page.at(-1)!.id : null,
    };
  });

  app.get('/api/uploads/:id', async (request): Promise<UploadResponse> => {
    return detailResponse(await visibleUpload(request), request);
  });

  // People correcting or confirming the extracted data ----------------------------------------
  app.patch('/api/uploads/:id/result', async (request): Promise<UploadResponse> => {
    const { id } = await visibleUpload(request);
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

  // One upload's history, for its detail: open to anyone who can see the upload, unlike the whole
  // activity log. Newest first, a page at a time, searched and filtered like the log.
  app.get('/api/uploads/:id/history', async (request): Promise<UploadHistoryResponse> => {
    const query = uploadHistoryQuerySchema.safeParse(request.query);
    if (!query.success) throw new ApiError(400, 'BAD_REQUEST', `${ACTIVITY_QUERY_HELP}, and limit=1–200.`);
    const { id } = await visibleUpload(request);
    const { q, type, from, to, cursor, limit } = query.data;
    const [records, currentVersionId] = await Promise.all([
      // One extra row: if it comes back, there's another page after this one.
      events.list({
        types: type,
        search: q || undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        uploadId: id,
        limit: limit + 1,
        after: cursor,
      }),
      uploads.latestVersionId(id),
    ]);
    const page = records.slice(0, limit);
    return {
      entries: toHistoryEntries(page, currentVersionId),
      nextCursor: records.length > limit ? page.at(-1)!.id : null,
    };
  });

  // One history entry's details (what was read, or what changed), read only when someone opens it.
  app.get('/api/uploads/:id/history/:eventId', async (request): Promise<EventDetails> => {
    const { id } = await visibleUpload(request);
    const event = await events.find(eventId(request.params));
    if (!event || event.uploadId !== id) throw notFound('Event');
    return eventDetails(event, uploads);
  });

  // An admin putting a product's data back to an earlier version ------------------------------
  app.post('/api/uploads/:id/revert', { preHandler: requireRole('admin') }, async (request): Promise<UploadResponse> => {
    const body = revertRequestSchema.safeParse(request.body);
    if (!body.success) throw new ApiError(400, 'BAD_REQUEST', 'Expected { revision, versionId }.');
    const result = await revertUpload({ uploads, events }, uploadId(request.params), body.data, request.member!);

    switch (result.outcome) {
      case 'reverted':
        return detailResponse(result.upload, request);
      case 'conflict':
        throw new ApiError(409, 'EDIT_CONFLICT', 'Someone else changed this upload since you opened it.');
      case 'not-revertible':
        throw new ApiError(409, 'NOT_EDITABLE', 'Only a completed upload can be reverted.');
      case 'not-found':
        throw notFound();
    }
  });

  // Manual retry of a failed upload ------------------------------------------------------------
  app.post('/api/uploads/:id/retry', async (request): Promise<UploadResponse> => {
    const { id } = await visibleUpload(request);
    const result = await retryUpload({ uploads, events }, id, request.member!);

    switch (result.outcome) {
      case 'requeued':
        return detailResponse(result.upload, request);
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
    const result = await deleteUpload({ uploads, storage, events }, uploadId(request.params), request.member!);

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
