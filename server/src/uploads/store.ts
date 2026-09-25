import type postgres from 'postgres';
import type {
  LabelExtraction,
  SupportedMimeType,
  UploadErrorCode,
  UploadStatus,
} from '@label-extractor/shared';
import { labelExtractionSchema } from '@label-extractor/shared';
import type { ExtractionQueue } from '../infra/queue.ts';

/**
 * All reads and writes of the `uploads` table.
 *
 * Every status change is a *guarded transition*: `UPDATE … WHERE status IN (<allowed from-states>)`.
 * If the row isn't in an allowed state the update matches nothing and the method returns `null`.
 * That makes every operation idempotent and race-safe without explicit locks — e.g. a
 * double-clicked "complete", or the same job delivered twice, simply becomes a no-op.
 */

export interface UploadRecord {
  id: string;
  fileName: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
  storagePath: string;
  status: UploadStatus;
  attempts: number;
  error: UploadFailure | null;
  result: LabelExtraction | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** Only the code is stored; the shared catalogue turns it into the message users see. */
export interface UploadFailure {
  code: UploadErrorCode;
}

export interface NewUpload {
  id: string;
  fileName: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
  storagePath: string;
}

export interface UploadStore {
  // ---- Used by the API --------------------------------------------------------------------
  create(upload: NewUpload): Promise<UploadRecord>;
  findById(id: string): Promise<UploadRecord | null>;
  /** Newest first, excluding rows the browser hasn't finished uploading. */
  listRecent(limit: number): Promise<UploadRecord[]>;
  /** Every completed upload, newest first, read in batches so an export of any size can stream. */
  streamCompleted(): AsyncIterable<UploadRecord>;
  /** `uploading → queued` and enqueue the job, atomically. `mimeType` is the type sniffed from the bytes. */
  markUploaded(id: string, mimeType: SupportedMimeType): Promise<UploadRecord | null>;
  /** `uploading → failed`, for files rejected after upload (e.g. content isn't really an image). */
  rejectUpload(id: string, code: UploadErrorCode): Promise<UploadRecord | null>;
  /** `failed → queued` with attempts reset, and enqueue a fresh job, atomically. */
  requeueFailed(id: string): Promise<UploadRecord | null>;

  // ---- Used by the worker -----------------------------------------------------------------
  /**
   * `queued|processing → processing` and count the attempt. `processing` is allowed as a
   * from-state so a job retried after a worker crash can pick the upload back up.
   */
  startAttempt(id: string): Promise<UploadRecord | null>;
  /** `processing → completed` with the validated result. */
  complete(id: string, result: LabelExtraction): Promise<UploadRecord | null>;
  /** `processing → queued`, recording why this attempt failed; the queue will retry it. */
  scheduleRetry(id: string, code: UploadErrorCode): Promise<UploadRecord | null>;
  /** `queued|processing → failed` — permanent. */
  fail(id: string, code: UploadErrorCode): Promise<UploadRecord | null>;
}

export function createUploadStore(sql: postgres.Sql, queue: ExtractionQueue): UploadStore {
  /** Runs a guarded UPDATE and returns the updated row, or null if the guard didn't match. */
  async function transition(query: Promise<postgres.Row[]>): Promise<UploadRecord | null> {
    const [row] = await query;
    return row ? toRecord(row) : null;
  }

  return {
    async create(upload) {
      const [row] = await sql`
        insert into uploads (id, file_name, mime_type, size_bytes, storage_path)
        values (${upload.id}, ${upload.fileName}, ${upload.mimeType}, ${upload.sizeBytes}, ${upload.storagePath})
        returning *`;
      return toRecord(row!);
    },

    async findById(id) {
      const [row] = await sql`select * from uploads where id = ${id}`;
      return row ? toRecord(row) : null;
    },

    async listRecent(limit) {
      const rows = await sql`
        select * from uploads
        where status <> 'uploading'
        order by created_at desc
        limit ${limit}`;
      return rows.map(toRecord);
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

    async markUploaded(id, mimeType) {
      // Row update and job creation share one transaction: we can never end up with a `queued`
      // row that has no job (stuck forever) or a job for a row that isn't `queued`.
      return sql.begin(async (tx) => {
        const record = await transition(tx`
          update uploads set status = 'queued', mime_type = ${mimeType}
          where id = ${id} and status = 'uploading'
          returning *`);
        if (record) await queue.enqueue(id, tx);
        return record;
      });
    },

    rejectUpload(id, code) {
      return transition(sql`
        update uploads set status = 'failed', error_code = ${code}
        where id = ${id} and status = 'uploading'
        returning *`);
    },

    async requeueFailed(id) {
      return sql.begin(async (tx) => {
        const record = await transition(tx`
          update uploads
          set status = 'queued', attempts = 0, error_code = null
          where id = ${id} and status = 'failed'
          returning *`);
        if (record) await queue.enqueue(id, tx);
        return record;
      });
    },

    startAttempt(id) {
      return transition(sql`
        update uploads
        set status = 'processing', attempts = attempts + 1, error_code = null
        where id = ${id} and status in ('queued', 'processing')
        returning *`);
    },

    complete(id, result) {
      return transition(sql`
        update uploads
        set status = 'completed', result = ${sql.json(result as postgres.JSONValue)}, completed_at = now(),
            error_code = null
        where id = ${id} and status = 'processing'
        returning *`);
    },

    scheduleRetry(id, code) {
      return transition(sql`
        update uploads set status = 'queued', error_code = ${code}
        where id = ${id} and status = 'processing'
        returning *`);
    },

    fail(id, code) {
      return transition(sql`
        update uploads set status = 'failed', error_code = ${code}
        where id = ${id} and status in ('queued', 'processing')
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
    status: row.status,
    attempts: row.attempts,
    error: row.error_code ? { code: row.error_code } : null,
    result: readStoredResult(row.result),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

/**
 * Stored results are read back through the extraction schema, which upgrades older shapes (such as
 * ingredients saved as plain strings) to the current one. Anything unreadable is treated as absent
 * rather than passed on half-formed.
 */
function readStoredResult(value: unknown): LabelExtraction | null {
  if (value === null || value === undefined) return null;
  const parsed = labelExtractionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
