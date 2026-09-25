import { z } from 'zod';
import { LOG_EVENT_TYPE_IDS, type LogEventType } from './logs.ts';
import { UPLOAD_FILTER_IDS, type UploadFilter } from './uploads.ts';

/**
 * Zod schemas for request bodies and query strings, which the API validates.
 *
 * Kept apart from uploads.ts on purpose: the web app imports that file for small runtime helpers
 * (statuses, filters), and a module that builds Zod schemas at load time can't be tree-shaken, so
 * having them there shipped all of Zod to every browser. The web only needs these as types.
 */

/** POST /api/uploads — ask for a signed URL to upload one file to. */
export const createUploadRequestSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  /** SHA-256 of the file's bytes, as lowercase hex. Lets the API spot a file it already has. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

/** GET /api/uploads?status=…&cursor=…&limit=… — newest first, one page at a time. */
export const listUploadsQuerySchema = z.object({
  status: z.enum(UPLOAD_FILTER_IDS as [UploadFilter, ...UploadFilter[]]).default('all'),
  /** The `nextCursor` of the previous page. */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const logEventType = z.enum(LOG_EVENT_TYPE_IDS as [LogEventType, ...LogEventType[]]);

/** GET /api/logs?type=…&type=…&upload=…&cursor=…&limit=… — newest first, one page at a time. */
export const listLogsQuerySchema = z.object({
  /** One `type` parameter per type of event wanted; none means every type. */
  type: z
    .union([logEventType, z.array(logEventType)])
    .optional()
    .transform((value) => [...new Set(value === undefined ? [] : [value].flat())]),
  /** Only this upload's events. */
  upload: z.uuid().optional(),
  /** The `nextCursor` of the previous page: an event ID. */
  cursor: z.string().regex(/^\d{1,19}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListLogsQuery = z.input<typeof listLogsQuerySchema>;
