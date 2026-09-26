import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Authenticator } from '../auth/authenticator.ts';
import type { Logger } from '../infra/logger.ts';
import { requireSignIn } from './auth.ts';
import { handleError, notFound } from './errors.ts';
import { eventRoutes, type EventRoutesDeps } from './routes/events.ts';
import { exportRoutes, type ExportRoutesDeps } from './routes/exports.ts';
import { logRoutes, type LogRoutesDeps } from './routes/logs.ts';
import { opsRoutes, type OpsRoutesDeps } from './routes/ops.ts';
import { sessionRoutes, type SessionRoutesDeps } from './routes/session.ts';
import { uploadRoutes, type UploadRoutesDeps } from './routes/uploads.ts';

/** What every route needs, together. Each route module declares only the slice it uses. */
export type AppDeps = UploadRoutesDeps &
  ExportRoutesDeps &
  EventRoutesDeps &
  LogRoutesDeps &
  OpsRoutesDeps &
  SessionRoutesDeps & {
    logger: Logger;
    /** Who each /api request is from (see api/auth.ts). */
    authenticator: Authenticator;
    /** Built web app to serve alongside the API (production). Omit in development: Vite serves it. */
    webDistDir?: string;
  };

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
  // Before any route is registered, so every route is behind it (public paths: see api/auth.ts).
  app.decorateRequest('member', null);
  app.addHook('onRequest', requireSignIn(deps.authenticator));

  await app.register(sessionRoutes, deps);
  await app.register(opsRoutes, deps);
  await app.register(uploadRoutes, deps);
  await app.register(exportRoutes, deps);
  await app.register(eventRoutes, deps);
  await app.register(logRoutes, deps);

  if (deps.webDistDir) {
    // Serve the single-page app: its files, and index.html for its own page routes.
    await app.register(fastifyStatic, { root: path.resolve(deps.webDistDir), wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    // Only page routes get the app, which routes them itself. A missing *file* is a 404: after a
    // deploy, a tab opened earlier asks for the old build's chunks, and answering with the page's
    // HTML made the browser's import of them fail, crashing the page (the app reloads instead).
    if (deps.webDistDir && request.method === 'GET' && !request.url.startsWith('/api/') && isPageRoute(request.url)) {
      return reply.sendFile('index.html');
    }
    throw notFound('Route');
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

/** A path the web app routes itself (/status, /uploads/:id…): anything that isn't a file name. */
function isPageRoute(url: string): boolean {
  return path.extname(new URL(url, 'http://localhost').pathname) === '';
}
