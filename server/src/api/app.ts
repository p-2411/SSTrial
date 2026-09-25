import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Logger } from '../infra/logger.ts';
import { handleError, notFound } from './errors.ts';
import { uploadRoutes, type UploadRoutesDeps } from './routes/uploads.ts';

export interface AppDeps extends UploadRoutesDeps {
  logger: Logger;
  /** Built web app to serve alongside the API (production). Omit in development: Vite serves it. */
  webDistDir?: string;
}

/**
 * Builds the HTTP app from its dependencies without starting it. Tests call this with in-memory
 * fakes and send requests through `app.inject()` — no network, database or storage needed.
 */
export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    loggerInstance: deps.logger,
    // Only JSON metadata ever comes through the API (file bytes go straight to storage).
    bodyLimit: 64 * 1024,
  });

  app.setErrorHandler(handleError);

  app.get('/api/health', async () => ({ status: 'ok' }));
  await app.register(uploadRoutes, deps);

  if (deps.webDistDir) {
    // Serve the single-page app; any non-API path falls back to index.html for client routing.
    await app.register(fastifyStatic, { root: path.resolve(deps.webDistDir), wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    if (deps.webDistDir && request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    throw notFound('Route');
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
