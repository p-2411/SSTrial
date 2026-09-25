import type { FastifyInstance } from 'fastify';
import type { HealthReport, OpsStatusResponse } from '@label-extractor/shared';
import { healthStatusCode } from '../../ops/health.ts';
import { requireRole } from '../auth.ts';
import { toOpsStatus } from '../../ops/presenter.ts';
import type { OpsStore } from '../../ops/store.ts';

export interface OpsRoutesDeps {
  /** Runs the API's readiness checks (database, queue). */
  health: () => Promise<HealthReport>;
  ops: Pick<OpsStore, 'snapshot'>;
}

/** Health and monitoring endpoints. The System status page reads GET /api/ops. */
export async function opsRoutes(app: FastifyInstance, { health, ops }: OpsRoutesDeps) {
  app.get('/api/health', async (_request, reply): Promise<HealthReport> => {
    const report = await health();
    reply.status(healthStatusCode(report));
    return report;
  });

  app.get('/api/ops', { preHandler: requireRole('admin') }, async (): Promise<OpsStatusResponse> => {
    const [report, snapshot] = await Promise.all([health(), ops.snapshot()]);
    return toOpsStatus(snapshot, report);
  });
}
