import { createService, env, onShutdown } from '@def-ops/service-kit';
import { SessionManager } from './auth/sessions';
import { SecurityAudit } from './auth/security-audit';
import { CartographyEnvironmentProvider } from './environment/cartography-provider';
import { EnvironmentSnapshotStore } from './environment/snapshot-store';
import { registerExpositionRoutes } from './http/exposition-routes';
import { createTrainingExpositionService } from './exposition/training-exposition';
import { buildTask52Router } from './http/contracts';
import { createKshviPersistence } from './persistence';
import { CommandService } from './instances/command-service';
import { RevisionTrackingCommandPort } from './instances/typed-command-port';
import { registerAgentRoutes } from './http/agent-routes';
import { loadConfiguredProductionRuntime } from './runtime/production-config';

const persistence = await createKshviPersistence(process.env);
const pool = persistence.pool;
const sessions = new SessionManager({ store: persistence.sessionStore });
const audit = new SecurityAudit();
const environmentProvider = new CartographyEnvironmentProvider({
  baseUrl: env('CARTOGRAPHY_URL', 'http://localhost:8104/cartography'),
  store: new EnvironmentSnapshotStore(env('KSHVI_ENVIRONMENT_DIR', './data/kshvi/environment')),
});
const commands = new CommandService({
  ...(persistence.eventStore ? { store: persistence.eventStore } : {}),
  organizationId: env('KSHVI_ORGANIZATION_ID', 'default'),
});
const commandPort = new RevisionTrackingCommandPort(commands);
const port = Number(env('PORT', '8105'));
const production = await loadConfiguredProductionRuntime({
  configPath: process.env.KSHVI_WORKERS_CONFIG,
  sessions,
  commands: commandPort,
  revision: (instanceId, branchId) => commandPort.revision(instanceId, branchId),
  commandBaseUrl: env('KSHVI_INTERNAL_URL', `http://127.0.0.1:${port}`),
});
const router = buildTask52Router({
  sessions,
  exerciseStore: persistence.exerciseStore,
  environmentProvider,
  commands,
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
registerAgentRoutes(router, { commands: commandPort, resolveDelegation: production.resolveDelegation });
registerExpositionRoutes(router, createTrainingExpositionService());
const service = createService({
  name: 'kshvi',
  version: '0.1.0',
  port,
  router,
  ready: async () => pool ? (await pool.query('select 1')).rowCount === 1 : true,
});
await service.listen();
await production.start();
onShutdown(async () => {
  await production.stop();
  await service.close();
  if (pool) await pool.end();
});
