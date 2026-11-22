import { createService, env, onShutdown } from '@def-ops/service-kit';
import { SessionManager } from './auth/sessions';
import { SecurityAudit } from './auth/security-audit';
import { CartographyEnvironmentProvider } from './environment/cartography-provider';
import { EnvironmentSnapshotStore } from './environment/snapshot-store';
import { buildTask52Router } from './http/contracts';
import { createKshviPersistence } from './persistence';
import { CommandService } from './instances/command-service';
import { RevisionTrackingCommandPort } from './instances/typed-command-port';
import { registerAgentRoutes } from './http/agent-routes';
import { loadConfiguredProductionRuntime } from './runtime/production-config';
import { FileExpositionRepository } from './exposition/exposition-repository';
import { createFileExpositionService } from './exposition/exposition-runtime';
import { publishChainEvent, SubscriptionService } from './http/subscription-service';

const environmentStore = new EnvironmentSnapshotStore(env('KSHVI_ENVIRONMENT_DIR', './data/kshvi/environment'));
const persistence = await createKshviPersistence(process.env, { environment: environmentStore });
const pool = persistence.pool;
const sessions = new SessionManager({ store: persistence.sessionStore });
const audit = new SecurityAudit();
const environmentProvider = new CartographyEnvironmentProvider({
  baseUrl: env('CARTOGRAPHY_URL', 'http://localhost:8104/cartography'),
  store: environmentStore,
});
const exposition = await createFileExpositionService({
  repository: new FileExpositionRepository({
    archivePath: env('KSHVI_EXPOSITION_ARCHIVE', './data/kshvi/exposition/official-archive.json'),
    programPath: env('KSHVI_EXPOSITION_PROGRAM', './data/kshvi/exposition/program.json'),
    statePath: env('KSHVI_EXPOSITION_STATE', './data/kshvi/exposition/sessions.json'),
  }),
  runtimePath: env('KSHVI_EXPOSITION_RUNTIME', './data/kshvi/exposition/runtime.json'),
  archivePath: env('KSHVI_EXPOSITION_ARCHIVE', './data/kshvi/exposition/official-archive.json'),
  programPath: env('KSHVI_EXPOSITION_PROGRAM', './data/kshvi/exposition/program.json'),
  allowDemoFixtures: env('KSHVI_MODE', 'development') === 'development' && env('NODE_ENV', 'development') !== 'production',
});
const subscriptions = new SubscriptionService();
const commands = new CommandService({
  ...(persistence.eventStore ? { store: persistence.eventStore } : {}),
  organizationId: env('KSHVI_ORGANIZATION_ID', 'default'),
  eventSink: event => publishChainEvent(subscriptions, event),
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
  evidence: persistence.evidence,
  environmentProvider,
  commands,
  subscriptions,
  wallClock: () => new Date(),
  exposition: { service: exposition, sessions },
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
