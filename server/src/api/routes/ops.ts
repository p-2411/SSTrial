import type { FastifyInstance } from 'fastify';
import type { HealthReport, OpsStatusResponse } from '@label-extractor/shared';
import { toOpsStatus } from '../../ops/presenter.ts';
import type { OpsStore } from '../../ops/store.ts';

export interface OpsRoutesDeps {
  /** Runs the API's readiness checks (database, queue). */
  health: () => Promise<HealthReport>;
  ops: Pick<OpsStore, 'snapshot'>;
}

/** Health and monitoring endpoints. The System status page reads GET /api/ops. */
export async function opsRoutes(app: FastifyInstance, { health, ops }: OpsRoutesDeps) {
  // 200 when every check passes, 503 otherwise — the status code is what load balancers and
  // Railway's deploy checks look at; the body says which dependency failed.
  app.get('/api/health', async (_request, reply): Promise<HealthReport> => {
    const report = await health();
    reply.status(report.status === 'ok' ? 200 : 503);
    return report;
  });

  app.get('/api/ops', async (): Promise<OpsStatusResponse> => {
    const [report, snapshot] = await Promise.all([health(), ops.snapshot()]);
    return toOpsStatus(snapshot, report, new Date());
  });
}
