import { z } from 'zod';
import { LABEL_FIELDS, type LabelField } from './fields.ts';
import { LOG_EVENT_TYPE_IDS, type LogEventType } from './logs.ts';
import { NET_QUANTITY_UNITS } from './units.ts';
import { UPLOAD_VIEW_IDS, type UploadView } from './uploads.ts';

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

/** GET /api/uploads?view=…&cursor=…&limit=… — newest first, one page at a time. */
export const listUploadsQuerySchema = z.object({
  view: z.enum(UPLOAD_VIEW_IDS as [UploadView, ...UploadView[]]).default('products'),
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

/**
 * PATCH /api/uploads/:id/result (RESULT_EDIT_PATH). This checks the request's shape only; the
 * edited result is then validated as a whole by labelExtractionSchema, the same rules model output
 * passes.
 */
export const editResultRequestSchema = z.object({
  /** The revision the edit was made against. A save against an older one is refused (409). */
  revision: z.number().int().min(0),
  /** A person's corrections. Only the fields given change; each is re-validated like model output. */
  changes: z
    .strictObject({
      productName: z.string().nullable().optional(),
      brand: z.string().nullable().optional(),
      /**
       * The amount and unit. The pack's printed wording is kept if it states this amount;
       * otherwise (it was misread too, or there was none) it becomes the amount.
       */
      netWeight: z.object({ value: z.number(), unit: z.enum(NET_QUANTITY_UNITS) }).nullable().optional(),
      allergens: z.array(z.string()).optional(),
      ingredients: z
        .array(
          z.object({
            name: z.string(),
            percent: z.number().nullable(),
            subIngredients: z.array(z.string()),
            allergens: z.array(z.string()),
          }),
        )
        .optional(),
    })
    .optional(),
  /** Fields confirmed as right, unchanged. */
  checked: z.array(z.enum(LABEL_FIELDS as [LabelField, ...LabelField[]])).optional(),
});
export type EditResultRequest = z.input<typeof editResultRequestSchema>;
export type ResultChanges = NonNullable<EditResultRequest['changes']>;

/** POST /api/uploads/:id/revert — admins only. Made against the revision the admin saw, like an edit. */
export const revertRequestSchema = z.object({
  revision: z.number().int().min(0),
  /** A version's ID, from the upload's history (`revertTo`). */
  versionId: z.string().regex(/^\d{1,19}$/),
});
export type RevertRequest = z.infer<typeof revertRequestSchema>;
