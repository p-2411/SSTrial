import type { FastifyInstance } from 'fastify';
import { listLogsQuerySchema, LOG_EVENTS_PATH, PAGE_SIZES, type EventDetails, type ListLogsResponse } from '@label-extractor/shared';
import { eventDetails } from '../../logs/details.ts';
import { toLogEvent } from '../../logs/presenter.ts';
import type { EventQueries } from '../../logs/store.ts';
import type { UploadVersions } from '../../uploads/store.ts';
import { requireRole } from '../auth.ts';
import { ApiError, notFound } from '../errors.ts';
import { ACTIVITY_QUERY_HELP, pageOf, wordsAndTime } from '../paging.ts';
import { eventIdParam } from '../params.ts';

export interface LogRoutesDeps {
  events: EventQueries;
  /** For the details of changes to a product's data, read from the versions they saved. */
  uploads: Pick<UploadVersions, 'readVersion'>;
}

/**
 * GET /api/logs — the activity log, newest first, filtered and paginated like the upload list.
 * GET /api/logs/:id/details — one event's details, read only when someone opens them.
 */
export async function logRoutes(app: FastifyInstance, { events, uploads }: LogRoutesDeps) {
  app.get(LOG_EVENTS_PATH, { preHandler: requireRole('admin') }, async (request): Promise<ListLogsResponse> => {
    const query = listLogsQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ApiError(400, 'BAD_REQUEST', `${ACTIVITY_QUERY_HELP}, upload=an upload ID, and limit=1–${PAGE_SIZES.logs.max}.`);
    }
    const { type, upload, cursor, limit } = query.data;
    const records = await events.list({ types: type, ...wordsAndTime(query.data), uploadId: upload, limit: limit + 1, after: cursor });
    const { page, nextCursor } = pageOf(records, limit, (event) => event.id);
    return { events: page.map((event) => toLogEvent(event, 'log')), nextCursor };
  });

  app.get(`${LOG_EVENTS_PATH}/:eventId/details`, { preHandler: requireRole('admin') }, async (request): Promise<EventDetails> => {
    const event = await events.find(eventIdParam(request.params));
    if (!event) throw notFound('Event');
    return eventDetails(event, uploads);
  });
}
