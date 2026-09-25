import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { toCsv, toJson } from '../../uploads/export.ts';
import type { UploadStore } from '../../uploads/store.ts';

export interface ExportRoutesDeps {
  uploads: Pick<UploadStore, 'streamCompleted'>;
}

/**
 * Downloads of every completed extraction. Generated here rather than in the browser, which only
 * holds the latest summaries: the export streams straight from the database, whatever its size.
 */
export async function exportRoutes(app: FastifyInstance, { uploads }: ExportRoutesDeps) {
  app.get('/api/exports/uploads.csv', async (_request, reply) => {
    return sendDownload(reply, 'text/csv; charset=utf-8', 'csv', toCsv(uploads.streamCompleted()));
  });

  app.get('/api/exports/uploads.json', async (_request, reply) => {
    return sendDownload(reply, 'application/json; charset=utf-8', 'json', toJson(uploads.streamCompleted(), new Date()));
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
