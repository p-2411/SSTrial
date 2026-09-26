import type postgres from 'postgres';
import {
  extractionConfidenceSchema,
  isFieldReviewKind,
  LABEL_FIELDS,
  labelExtractionSchema,
  storedErrorCode,
  UPLOAD_TRANSITIONS,
  type ExtractionConfidence,
  type FieldReviewKind,
  type LabelExtraction,
  type LabelField,
  type SupportedMimeType,
  type UploadErrorCode,
  type UploadStatus,
  type UploadTransition,
  type UploadTransitionKeepingRow,
} from '@label-extractor/shared';
import type { UploadJobs } from './jobs.ts';

/**
 * All reads and writes of the `uploads` table.
 *
 * Every status change is a *guarded transition* from shared/src/lifecycle.ts:
 * `UPDATE … WHERE status = any(<allowed from-states>)`. If the row isn't in an allowed state the
 * update matches nothing and the method returns `null`.
 * That makes every operation idempotent and race-safe without explicit locks — e.g. a
 * double-clicked "complete", or the same job delivered twice, simply becomes a no-op.
 *
 * The worker's writes are also fenced by a claim token: each processing attempt gets a fresh one,
 * and only the attempt holding the current token can finish the upload. A worker whose job was
 * handed to another worker (it stopped heartbeating) can't overwrite anything afterwards.
 */

export interface UploadRecord {
  id: string;
  fileName: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
  storagePath: string;
  /** SHA-256 of the file (hex). Claimed by the browser at first, replaced by the worker's own hash. */
  contentSha256: string | null;
  /** Who uploaded it (a Supabase Auth user ID); null for uploads from before sign-in existed. */
  uploadedBy: string | null;
  status: UploadStatus;
  attempts: number;
  error: UploadFailure | null;
  /** The data people see: the model's output, with any corrections. */
  result: LabelExtraction | null;
  /** The row has a result, but it no longer matches the extraction schema. */
  resultUnreadable: boolean;
  /** The model's own output, kept when someone first edits `result`; null until then. */
  originalResult: LabelExtraction | null;
  /**
   * The model's own score for each field, as it gave them; null if it wasn't scored. Checks against
   * the data (applyConfidenceChecks) are applied when read, so edits are taken into account.
   */
  confidence: ExtractionConfidence | null;
  /** Who has edited or checked which fields (see uploads/edit.ts). */
  fieldReviews: StoredFieldReviews;
  /** Goes up with every saved edit, so an edit made against an older version can be refused. */
  resultRevision: number;
  /** The processing attempt that currently owns the upload (see `startAttempt`). */
  claimToken: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** Who reviewed a field (their user ID) and when. The API names them by email. */
export interface StoredFieldReview {
  kind: FieldReviewKind;
  by: string;
  at: Date;
}

export type StoredFieldReviews = Partial<Record<LabelField, StoredFieldReview>>;

/** Only the code is stored; the shared catalogue turns it into the message users see. */
interface UploadFailure {
  code: UploadErrorCode;
}

export interface NewUpload {
  id: string;
  fileName: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
  storagePath: string;
  contentSha256: string | null;
  uploadedBy: string | null;
}

/** Options for the two ways an upload leaves `uploading`. */
export interface SettleOptions {
  /** Cancel the upload's finalise job in the same transaction (see UploadJobs.cancelFinalise). */
  cancelFinalise?: boolean;
}

/** Reading uploads, for the API. */
export interface UploadQueries {
  findById(id: string): Promise<UploadRecord | null>;
  /** The newest queued, processing or completed upload of a file with this hash, if any. */
  findByContentHash(sha256: string): Promise<UploadRecord | null>;
  /**
   * One page of uploads in the given statuses, newest first, and only `uploadedBy`'s if given.
   * `after` is the ID of the last upload on the previous page (keyset pagination: stable while new
   * uploads arrive, and fast at any depth).
   */
  list(options: { statuses: readonly UploadStatus[]; uploadedBy?: string; limit: number; after?: string }): Promise<UploadRecord[]>;
  /** How many uploads this person has under way (uploading, waiting or being read). */
  countUnderWay(uploadedBy: string): Promise<number>;
  /** Every completed upload, newest first, read in batches so an export of any size can stream. */
  streamCompleted(): AsyncIterable<UploadRecord>;
}

/** Getting uploads into the queue: creating, confirming or discarding them, and running them again. */
export interface UploadIntake {
  /** Inserts the row and schedules its finalise job, atomically (see FINALISE_QUEUE). */
  create(upload: NewUpload): Promise<UploadRecord>;
  /** `uploading → queued` and enqueue the job, atomically. `mimeType` is the type sniffed from the bytes. */
  markUploaded(id: string, mimeType: SupportedMimeType, options?: SettleOptions): Promise<UploadRecord | null>;
  /**
   * Deletes an upload that never finished uploading, or whose file was rejected. Only `uploading`
   * rows can go, so a confirmed upload is never removed by a late or duplicate call.
   */
  discardUnfinished(id: string, options?: SettleOptions): Promise<UploadRecord | null>;
  /**
   * `failed|completed → queued` with attempts and any result cleared, and enqueue a fresh job,
   * atomically. `from` is the status the caller saw, so a concurrent change makes this a no-op.
   */
  requeue(id: string, from: (typeof UPLOAD_TRANSITIONS.rerun.from)[number]): Promise<UploadRecord | null>;
}

/** Processing attempts, for the worker. Every write after startAttempt needs its claim token. */
export interface UploadAttempts {
  /**
   * `queued|processing → processing`, count the attempt and issue a fresh claim token, which the
   * attempt must present to finish. `processing` is allowed as a from-state so a job retried after
   * a worker crash can pick the upload back up — taking the claim from the old attempt.
   */
  startAttempt(id: string): Promise<UploadRecord | null>;
  /** Records the hash the worker computed from the actual bytes (the browser's is only a claim). */
  recordContentHash(id: string, sha256: string): Promise<void>;
  /** The newest *completed* upload of an identical file other than `excludeId`, to reuse its result. */
  findCompletedTwin(sha256: string, excludeId: string): Promise<UploadRecord | null>;
  /** `processing → completed` with the validated result. Null if `claimToken` is no longer current. */
  complete(
    id: string,
    claimToken: string,
    result: LabelExtraction,
    confidence: ExtractionConfidence | null,
  ): Promise<UploadRecord | null>;
  /** `processing → queued`, recording why this attempt failed; the queue will retry it. Needs the claim. */
  scheduleRetry(id: string, claimToken: string, code: UploadErrorCode): Promise<UploadRecord | null>;
  /** `processing → failed` — permanent. Needs the claim. */
  fail(id: string, claimToken: string, code: UploadErrorCode): Promise<UploadRecord | null>;
  /**
   * `queued|processing → failed`, whoever holds the claim. Only for the dead-letter safety net,
   * which runs when every attempt died without finishing and so no attempt will ever finish it.
   */
  failAbandoned(id: string, code: UploadErrorCode): Promise<UploadRecord | null>;
}

/** People correcting and confirming a completed upload's data. */
export interface UploadReviews {
  /**
   * Saves an edited result and who reviewed which fields, as the next revision. Only a completed
   * upload still at `revision` is changed, so an edit made against an older version saves nothing
   * (null). The model's own output is kept, on the first edit, as `original_result`.
   */
  saveReview(id: string, revision: number, result: LabelExtraction, fieldReviews: StoredFieldReviews): Promise<UploadRecord | null>;
}

/** Removing an upload someone asked to delete. */
export interface UploadRemoval {
  /**
   * Deletes the upload and cancels its finalise job, if still pending, atomically. Only from the
   * statuses the `delete` transition allows; null if it's gone already or not deletable.
   */
  remove(id: string): Promise<UploadRecord | null>;
}

/** The uploads table. Each consumer depends on the role it needs. */
export type UploadStore = UploadQueries & UploadIntake & UploadAttempts & UploadReviews & UploadRemoval;

export function createUploadStore(sql: postgres.Sql, jobs: UploadJobs): UploadStore {
  /**
   * The one row a query returns, or null. For guarded writes (`… where status = … returning *`),
   * null means the guard didn't match: the upload wasn't in the expected state.
   */
  async function oneRecord(query: Promise<postgres.Row[]>): Promise<UploadRecord | null> {
    const [row] = await query;
    return row ? toRecord(row) : null;
  }

  /** SQL guard for a lifecycle transition: the row must be in one of its from-statuses. */
  const allowedFrom = (transition: UploadTransition) =>
    sql`status = any(${[...UPLOAD_TRANSITIONS[transition].from]}::upload_status[])`;
  /** The status a lifecycle transition leads to. */
  const statusAfter = (transition: UploadTransitionKeepingRow) => UPLOAD_TRANSITIONS[transition].to;

  return {
    async create(upload) {
      // The finalise job is created with the row: an upload can't exist without the job that
      // guarantees it's eventually confirmed or discarded.
      return sql.begin(async (tx) => {
        const [row] = await tx`
          insert into uploads (id, file_name, mime_type, size_bytes, storage_path, content_sha256, uploaded_by)
          values (${upload.id}, ${upload.fileName}, ${upload.mimeType}, ${upload.sizeBytes}, ${upload.storagePath},
                  ${upload.contentSha256}, ${upload.uploadedBy})
          returning *`;
        await jobs.scheduleFinalise(upload.id, tx);
        return toRecord(row!);
      });
    },

    findById(id) {
      return oneRecord(sql`select * from uploads where id = ${id}`);
    },

    findByContentHash(sha256) {
      return oneRecord(sql`
        select * from uploads
        where content_sha256 = ${sha256} and status in ('queued', 'processing', 'completed')
        order by created_at desc
        limit 1`);
    },

    async recordContentHash(id, sha256) {
      await sql`update uploads set content_sha256 = ${sha256} where id = ${id}`;
    },

    findCompletedTwin(sha256, excludeId) {
      return oneRecord(sql`
        select * from uploads
        where content_sha256 = ${sha256} and status = 'completed' and id <> ${excludeId}
        order by completed_at desc
        limit 1`);
    },

    async list({ statuses, uploadedBy, limit, after }) {
      // The cursor row's own values are looked up in the database, so the comparison uses
      // Postgres's full microsecond timestamps rather than a millisecond-rounded copy.
      const rows = await sql`
        select * from uploads
        where status = any(${statuses as string[]}::upload_status[])
          ${uploadedBy ? sql`and uploaded_by = ${uploadedBy}` : sql``}
          ${after ? sql`and (created_at, id) < (select created_at, id from uploads where id = ${after})` : sql``}
        order by created_at desc, id desc
        limit ${limit}`;
      return rows.map(toRecord);
    },

    async countUnderWay(uploadedBy) {
      const [row] = await sql`
        select count(*)::int as count from uploads
        where uploaded_by = ${uploadedBy} and status in ('uploading', 'queued', 'processing')`;
      return row!.count;
    },

    async *streamCompleted() {
      const batches = sql`
        select * from uploads
        where status = 'completed'
        order by created_at desc`.cursor(500);
      for await (const rows of batches) {
        for (const row of rows) yield toRecord(row);
      }
    },

    async markUploaded(id, mimeType, options) {
      // Row update and job changes share one transaction: we can never end up with a `queued`
      // row that has no job (stuck forever) or a job for a row that isn't `queued`.
      return sql.begin(async (tx) => {
        const record = await oneRecord(tx`
          update uploads set status = ${statusAfter('confirm')}, mime_type = ${mimeType}
          where id = ${id} and ${allowedFrom('confirm')}
          returning *`);
        if (record) {
          await jobs.enqueueExtraction(id, tx);
          if (options?.cancelFinalise) await jobs.cancelFinalise(id, tx);
        }
        return record;
      });
    },

    remove(id) {
      return sql.begin(async (tx) => {
        const record = await oneRecord(tx`delete from uploads where id = ${id} and ${allowedFrom('delete')} returning *`);
        // Normally long settled; this covers an upload deleted before its finalise job ran.
        if (record) await jobs.cancelFinalise(id, tx);
        return record;
      });
    },

    discardUnfinished(id, options) {
      return sql.begin(async (tx) => {
        const record = await oneRecord(tx`delete from uploads where id = ${id} and ${allowedFrom('discard')} returning *`);
        if (record && options?.cancelFinalise) await jobs.cancelFinalise(id, tx);
        return record;
      });
    },

    async requeue(id, from) {
      return sql.begin(async (tx) => {
        const record = await oneRecord(tx`
          update uploads
          set status = ${statusAfter('rerun')}, attempts = 0, error_code = null, result = null, confidence = null,
              original_result = null, field_reviews = '{}'::jsonb,
              -- On, never back: an editor still open on the old result must not match the new one.
              result_revision = result_revision + 1,
              completed_at = null, claim_token = null
          where id = ${id} and status = ${from} and ${allowedFrom('rerun')}
          returning *`);
        if (record) await jobs.enqueueExtraction(id, tx);
        return record;
      });
    },

    startAttempt(id) {
      return oneRecord(sql`
        update uploads
        set status = ${statusAfter('claim')}, attempts = attempts + 1, error_code = null, claim_token = gen_random_uuid()
        where id = ${id} and ${allowedFrom('claim')}
        returning *`);
    },

    saveReview(id, revision, result, fieldReviews) {
      return oneRecord(sql`
        update uploads
        set status = ${statusAfter('review')},
            original_result = coalesce(original_result, result),
            result = ${sql.json(result as postgres.JSONValue)},
            field_reviews = ${sql.json(toStoredReviews(fieldReviews))},
            result_revision = result_revision + 1
        where id = ${id} and ${allowedFrom('review')} and result_revision = ${revision}
        returning *`);
    },

    complete(id, claimToken, result, confidence) {
      return oneRecord(sql`
        update uploads
        set status = ${statusAfter('complete')}, result = ${sql.json(result as postgres.JSONValue)},
            confidence = ${confidence ? sql.json(confidence as unknown as postgres.JSONValue) : null},
            completed_at = now(), error_code = null, claim_token = null
        where id = ${id} and ${allowedFrom('complete')} and claim_token = ${claimToken}
        returning *`);
    },

    scheduleRetry(id, claimToken, code) {
      return oneRecord(sql`
        update uploads set status = ${statusAfter('retryLater')}, error_code = ${code}, claim_token = null
        where id = ${id} and ${allowedFrom('retryLater')} and claim_token = ${claimToken}
        returning *`);
    },

    fail(id, claimToken, code) {
      return oneRecord(sql`
        update uploads set status = ${statusAfter('fail')}, error_code = ${code}, claim_token = null
        where id = ${id} and ${allowedFrom('fail')} and claim_token = ${claimToken}
        returning *`);
    },

    failAbandoned(id, code) {
      return oneRecord(sql`
        update uploads set status = ${statusAfter('abandon')}, error_code = ${code}, claim_token = null
        where id = ${id} and ${allowedFrom('abandon')}
        returning *`);
    },
  };
}

/** Maps a snake_case database row to our camelCase record. */
function toRecord(row: postgres.Row): UploadRecord {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    contentSha256: row.content_sha256 ?? null,
    uploadedBy: row.uploaded_by ?? null,
    claimToken: row.claim_token ?? null,
    status: row.status,
    attempts: row.attempts,
    error: row.error_code ? { code: storedErrorCode(row.error_code) } : null,
    ...readStoredResult(row.result),
    originalResult: readStoredResult(row.original_result).result,
    confidence: readStoredConfidence(row.confidence),
    fieldReviews: readStoredReviews(row.field_reviews),
    resultRevision: row.result_revision ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

/**
 * Stored results are read back through the extraction schema, which upgrades older shapes (such as
 * ingredients saved as plain strings) to the current one. Anything that still doesn't fit is never
 * passed on half-formed — but it isn't hidden either: `resultUnreadable` lets the UI say so and
 * offer to run the extraction again.
 */
function readStoredResult(value: unknown): { result: LabelExtraction | null; resultUnreadable: boolean } {
  if (value === null || value === undefined) return { result: null, resultUnreadable: false };
  const parsed = labelExtractionSchema.safeParse(value);
  return parsed.success ? { result: parsed.data, resultUnreadable: false } : { result: null, resultUnreadable: true };
}

/** Scores are advisory: any stored in a shape this version doesn't read are treated as not scored. */
function readStoredConfidence(value: unknown): ExtractionConfidence | null {
  if (value === null || value === undefined) return null;
  const parsed = extractionConfidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toStoredReviews(reviews: StoredFieldReviews): postgres.JSONValue {
  return Object.fromEntries(
    Object.entries(reviews).map(([field, review]) => [field, { kind: review.kind, by: review.by, at: review.at.toISOString() }]),
  );
}

/** Reviews read back leniently, field by field: one that doesn't fit is dropped, not the upload. */
function readStoredReviews(value: unknown): StoredFieldReviews {
  const reviews: StoredFieldReviews = {};
  if (typeof value !== 'object' || value === null) return reviews;
  for (const field of LABEL_FIELDS) {
    const review = (value as Record<string, unknown>)[field] as { kind?: unknown; by?: unknown; at?: unknown } | undefined;
    const at = typeof review?.at === 'string' ? new Date(review.at) : null;
    if (isFieldReviewKind(review?.kind) && typeof review.by === 'string' && at && !Number.isNaN(at.getTime())) {
      reviews[field] = { kind: review.kind, by: review.by, at };
    }
  }
  return reviews;
}
