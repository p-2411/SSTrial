import type { FastifyRequest } from 'fastify';
import { CONFIG_PATH, type CurrentMember, type Role } from '@label-extractor/shared';
import type { Authenticator } from '../auth/authenticator.ts';
import { ApiError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in member. Set on every /api route except the public ones. */
    member: CurrentMember | null;
  }
}

/** Reachable without signing in: Railway's health check, and what the browser needs to sign in. */
const PUBLIC_API_PATHS = new Set(['/api/health', CONFIG_PATH]);

/**
 * An `onRequest` hook: every /api request must come from a signed-in member, checked before any
 * route runs, and `request.member` says who. Paths outside /api (the web app's own files) stay
 * public, so the sign-in page can load.
 *
 * It checks the route the router matched, never the URL as written: the router decodes the path
 * first, so `/%61pi/uploads` reaches the /api/uploads handler, and a check on the raw text would
 * let it through. A request that matched no route gets a 404 and never reaches a handler.
 */
export function requireSignIn(authenticator: Authenticator) {
  return async (request: FastifyRequest) => {
    const route = request.routeOptions.url;
    if (route === undefined || !route.startsWith('/api/') || PUBLIC_API_PATHS.has(route)) return;

    const result = await authenticator.authenticate(request.headers.authorization);
    if (result.outcome === 'signed-out') throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
    if (result.outcome === 'no-access') {
      throw new ApiError(403, 'FORBIDDEN', "Your account doesn't have access to this workspace.");
    }
    request.member = result.member;
  };
}

/** Route pre-handler: only members with this role get through. */
export function requireRole(role: Role) {
  return async (request: FastifyRequest) => {
    if (request.member?.role !== role) throw new ApiError(403, 'FORBIDDEN', `Only ${role}s can see this.`);
  };
}
