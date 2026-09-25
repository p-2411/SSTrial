import type { FastifyInstance } from 'fastify';
import { CONFIG_PATH, ME_PATH, type CurrentMember, type PublicConfig } from '@label-extractor/shared';

export interface SessionRoutesDeps {
  publicConfig: PublicConfig;
}

/** What the browser needs to sign in (public), and who is signed in. */
export async function sessionRoutes(app: FastifyInstance, { publicConfig }: SessionRoutesDeps) {
  app.get(CONFIG_PATH, async (): Promise<PublicConfig> => publicConfig);
  // The sign-in hook has already set the member: this route is never public.
  app.get(ME_PATH, async (request): Promise<CurrentMember> => request.member!);
}
