import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '@label-extractor/shared';
import { StorageUnavailableError } from '../infra/storage.ts';

/**
 * An error a route throws on purpose: it becomes an HTTP response with this status, code and
 * message. The message is shown to users, so it must be plain language and never leak internals.
 */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const notFound = (what = 'Upload') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);

/**
 * Turns anything thrown in a route into the standard `{ error: { code, message } }` body.
 * Unexpected errors are logged in full but reported to the client generically.
 */
export function handleError(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  const send = (status: number, code: string, message: string) =>
    reply.status(status).send({ error: { code, message } } satisfies ApiErrorBody);

  if (error instanceof ApiError) {
    return send(error.statusCode, error.code, error.message);
  }
  if (error instanceof StorageUnavailableError) {
    request.log.error({ err: error }, 'Storage unavailable');
    return send(503, 'STORAGE_UNAVAILABLE', 'File storage is temporarily unavailable. Please try again shortly.');
  }
  // Fastify's own 4xx errors (malformed JSON, body too large, wrong content type…) are safe to relay.
  const statusCode = 'statusCode' in error ? error.statusCode : undefined;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return send(statusCode, 'BAD_REQUEST', error.message);
  }

  request.log.error({ err: error }, 'Unhandled error');
  return send(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
}
