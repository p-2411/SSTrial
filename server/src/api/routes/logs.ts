import type { FastifyInstance } from 'fastify';
import { listLogsQuerySchema, LOG_EVENT_TYPE_IDS, LOG_EVENTS_PATH, type ListLogsResponse } from '@label-extractor/shared';
import { toLogEvent } from '../../logs/presenter.ts';
import type { EventQueries } from '../../logs/store.ts';
import { requireRole } from '../auth.ts';
import { ApiError } from '../errors.ts';

export interface LogRoutesDeps {
  events: EventQueries;
}

/** GET /api/logs — the activity log, newest first, filtered and paginated like the upload list. */
export async function logRoutes(app: FastifyInstance, { events }: LogRoutesDeps) {
  app.get(LOG_EVENTS_PATH, { preHandler: requireRole('admin') }, async (request): Promise<ListLogsResponse> => {
    const query = listLogsQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ApiError(
        400,
        'BAD_REQUEST',
        `Use q=words to find (up to 200 characters), type=… once per type wanted (${LOG_EVENT_TYPE_IDS.join(', ')}), upload=an upload ID, a cursor from a previous page, and limit=1–200.`,
      );
    }
    const { q, type, upload, cursor, limit } = query.data;
    // Ask for one extra row: if it comes back, there's another page after this one.
    const records = await events.list({ types: type, search: q || undefined, uploadId: upload, limit: limit + 1, after: cursor });
    const page = records.slice(0, limit);
    return {
      events: page.map(toLogEvent),
      nextCursor: records.length > limit ? page.at(-1)!.id : null,
    };
  });
}
