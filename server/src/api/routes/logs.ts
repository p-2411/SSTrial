import type { FastifyInstance } from 'fastify';
import {
  listLogsQuerySchema,
  LOG_EVENT_TYPE_IDS,
  LOG_EVENTS_PATH,
  type EventDetails,
  type ListLogsResponse,
} from '@label-extractor/shared';
import { eventDetails } from '../../logs/details.ts';
import { toLogEvent } from '../../logs/presenter.ts';
import type { EventQueries } from '../../logs/store.ts';
import type { UploadQueries } from '../../uploads/store.ts';
import { requireRole } from '../auth.ts';
import { ApiError, notFound } from '../errors.ts';

export interface LogRoutesDeps {
  events: EventQueries;
  /** For the details of changes to a product's data, read from the versions they saved. */
  uploads: Pick<UploadQueries, 'readVersion'>;
}

/** The activity log's query parameters, as the log and each upload's history both take them. */
export const ACTIVITY_QUERY_HELP = `Use q=words to find (up to 200 characters), type=… once per type wanted (${LOG_EVENT_TYPE_IDS.join(', ')}), from= and to= as ISO date-times, and a cursor from a previous page`;

/** Event IDs are 64-bit integers: anything else can't be one. */
export function eventId(params: unknown): string {
  const { eventId } = params as { eventId: string };
  if (!/^\d{1,19}$/.test(eventId)) throw notFound('Event');
  return eventId;
}

/**
 * GET /api/logs — the activity log, newest first, filtered and paginated like the upload list.
 * GET /api/logs/:id/details — one event's details, read only when someone opens them.
 */
export async function logRoutes(app: FastifyInstance, { events, uploads }: LogRoutesDeps) {
  app.get(LOG_EVENTS_PATH, { preHandler: requireRole('admin') }, async (request): Promise<ListLogsResponse> => {
    const query = listLogsQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ApiError(400, 'BAD_REQUEST', `${ACTIVITY_QUERY_HELP}, upload=an upload ID, and limit=1–200.`);
    }
    const { q, type, from, to, upload, cursor, limit } = query.data;
    // Ask for one extra row: if it comes back, there's another page after this one.
    const records = await events.list({
      types: type,
      search: q || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      uploadId: upload,
      limit: limit + 1,
      after: cursor,
    });
    const page = records.slice(0, limit);
    return {
      events: page.map((event) => toLogEvent(event, 'log')),
      nextCursor: records.length > limit ? page.at(-1)!.id : null,
    };
  });

  app.get(`${LOG_EVENTS_PATH}/:eventId/details`, { preHandler: requireRole('admin') }, async (request): Promise<EventDetails> => {
    const event = await events.find(eventId(request.params));
    if (!event) throw notFound('Event');
    return eventDetails(event, uploads);
  });
}
