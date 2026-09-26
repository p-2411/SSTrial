import { z } from 'zod';
import { eventIdSchema } from '@label-extractor/shared';
import { notFound } from './errors.ts';

/** Route parameters. An ID that can't be one (malformed) names nothing, so it's a 404 like any unknown ID. */

const uploadIdParams = z.object({ id: z.uuid() });
const eventIdParams = z.object({ eventId: eventIdSchema });

/** The `:id` of a route under /api/uploads/:id. */
export function uploadIdParam(params: unknown): string {
  const parsed = uploadIdParams.safeParse(params);
  if (!parsed.success) throw notFound();
  return parsed.data.id;
}

/** The `:eventId` of a route naming one event. */
export function eventIdParam(params: unknown): string {
  const parsed = eventIdParams.safeParse(params);
  if (!parsed.success) throw notFound('Event');
  return parsed.data.eventId;
}
