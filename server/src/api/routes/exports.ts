import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ADDED_WITHIN_DAYS, exportQuerySchema, MAX_UPLOADS_PER_REQUEST } from '@label-extractor/shared';
import { toCsv, toJson } from '../../uploads/export.ts';
import type { UploadQueries } from '../../uploads/store.ts';
import { ApiError } from '../errors.ts';

export interface ExportRoutesDeps {
  uploads: Pick<UploadQueries, 'streamProducts'>;
}

/**
 * Downloads of products: the ones picked (`id`, once each), or else every one matching the list's
 * search and date filter. Generated here rather than in the browser, which only holds the pages
 * loaded so far: the export streams straight from the database, whatever its size.
 */
export async function exportRoutes(app: FastifyInstance, { uploads }: ExportRoutesDeps) {
  /** The products the query asks for. */
  function products(request: FastifyRequest) {
    const query = exportQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ApiError(400, 'BAD_REQUEST', `Use id=… for up to ${MAX_UPLOADS_PER_REQUEST} products, or q=… and added=7d|30d.`);
    }
    const { id: ids, q, added } = query.data;
    return uploads.streamProducts({ ids, search: q || undefined, addedWithinDays: added && ADDED_WITHIN_DAYS[added] });
  }

  app.get('/api/exports/uploads.csv', async (request, reply) => {
    return sendDownload(reply, 'text/csv; charset=utf-8', 'csv', toCsv(products(request)));
  });

  app.get('/api/exports/uploads.json', async (request, reply) => {
    return sendDownload(reply, 'application/json; charset=utf-8', 'json', toJson(products(request), new Date()));
  });
}

function sendDownload(reply: FastifyReply, contentType: string, extension: string, chunks: AsyncIterable<string>) {
  const date = new Date().toISOString().slice(0, 10);
  return reply
    .header('content-type', contentType)
    // "attachment" makes the browser save the file rather than display it.
    .header('content-disposition', `attachment; filename="label-extractions-${date}.${extension}"`)
    .header('cache-control', 'no-store')
    .send(Readable.from(chunks));
}
