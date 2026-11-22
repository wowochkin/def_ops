import { createService, env, onShutdown } from '@def-ops/service-kit';
import { SessionManager } from './auth/sessions';
import { SecurityAudit } from './auth/security-audit';
import { CartographyEnvironmentProvider } from './environment/cartography-provider';
import { EnvironmentSnapshotStore } from './environment/snapshot-store';
import { registerExpositionRoutes } from './http/exposition-routes';
import { createTrainingExpositionService } from './exposition/training-exposition';
import { buildTask52Router } from './http/contracts';
import { createKshviPersistence } from './persistence';

const persistence = await createKshviPersistence(process.env);
const pool = persistence.pool;
const sessions = new SessionManager({ store: persistence.sessionStore });
const audit = new SecurityAudit();
const environmentProvider = new CartographyEnvironmentProvider({
  baseUrl: env('CARTOGRAPHY_URL', 'http://localhost:8104'),
  store: new EnvironmentSnapshotStore(env('KSHVI_ENVIRONMENT_DIR', './data/kshvi/environment')),
});
const router = buildTask52Router({
  sessions,
  exerciseStore: persistence.exerciseStore,
  environmentProvider,
  audit: async record => {
    audit.append({
      actorId: record.actorId,
      organizationId: record.organizationId ?? 'default',
      action: record.action,
      outcome: record.outcome,
      correlationId: record.correlationId,
      ...(record.resourceId ? { resourceId: record.resourceId } : {}),
    });
  },
});
registerExpositionRoutes(router, createTrainingExpositionService());
const service = createService({
  name: 'kshvi',
  version: '0.1.0',
  port: Number(env('PORT', '8105')),
  router,
  ready: async () => pool ? (await pool.query('select 1')).rowCount === 1 : true,
});
await service.listen();
onShutdown(async () => { await service.close(); if (pool) await pool.end(); });
