import { HttpError, Router, reply, type Ctx } from '@def-ops/service-kit';
import { assertCsrf, clearSessionCookie, publicParticipant, SessionManager } from './auth/sessions';
import { KSHVI_ROUTE_PREFIX } from './http/router';
import { registerExerciseRoutes } from './http/exercise-routes';
import { InMemoryExerciseStore, type ExerciseStore } from './store/exercise-store';
import { MemoryModernImportStore, registerForceRoutes } from './http/force-routes';
import { addEnvironmentRoutes } from './http/environment-routes';
import { registerSymbolRoutes } from './http/symbol-routes';
import type { CartographyEnvironmentProvider } from './environment/cartography-provider';
import { InstanceService } from './instances/instance-service';
import { CommandService } from './instances/command-service';
import { ProjectionService } from './instances/projection-service';
import { SubscriptionService } from './http/subscription-service';
import { registerInstanceRoutes } from './http/instance-routes';
import { registerProjectionRoutes } from './http/projection-routes';
import { registerSseRoutes } from './http/sse';
import { SealingService } from './instances/sealing-service';
import { registerSealingRoutes } from './http/sealing-routes';
import type { ProjectableWorld } from '../../../packages/kshvi/src/projections/project';
import { OfficialSessionService } from './runtime/official-session-service';
import { registerWorkflowRoutes } from './http/workflow-routes';
import { registerArchiveRoutes } from './http/archive-routes';
import { registerExpositionRoutes } from './http/exposition-routes';
import type { ExpositionSessionService } from './exposition/exposition-session-service';
import { registerAdminRoutes } from './http/admin-routes';
import { AdminOverviewService } from './admin/admin-overview-service';
import { SessionAccountDirectory } from './auth/session-account-directory';
import { AssignmentService } from './auth/assignment-service';
import { ConfigCatalog } from './admin/config-catalog';
import { SecurityAudit } from './auth/security-audit';

function tokenOf(ctx: Ctx): string {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const cookies = ctx.req.headers.cookie ?? '';
  const pair = cookies.split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  if (!pair) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return decodeURIComponent(pair.slice('kshvi_session='.length));
}

export type BuildRouterOptions = {
  sessions: SessionManager;
  exerciseStore?: ExerciseStore;
  forceStore?: MemoryModernImportStore;
  environmentProvider?: CartographyEnvironmentProvider;
  instances?: InstanceService;
  commands?: CommandService;
  projections?: ProjectionService;
  subscriptions?: SubscriptionService;
  projectionWorld?: ProjectableWorld;
  sealing?: SealingService;
  workflow?: OfficialSessionService;
  wallClock?: () => Date;
  admin?: AdminOverviewService;
  exposition?: { service: ExpositionSessionService; sessions: SessionManager };
};

export function buildRouter({ sessions, exerciseStore = new InMemoryExerciseStore(), forceStore = new MemoryModernImportStore(), environmentProvider, instances = new InstanceService(), commands = new CommandService(), projections = new ProjectionService(), subscriptions = new SubscriptionService(), projectionWorld = { forces: [] }, sealing = new SealingService(), workflow, wallClock = () => new Date(), admin, exposition }: BuildRouterOptions): Router {
  const router = new Router();
  const integratedWorkflow = workflow ?? new OfficialSessionService(exerciseStore, { now: wallClock });
  const integratedAdmin = admin ?? new AdminOverviewService({
    directory: new SessionAccountDirectory(sessions), assignments: new AssignmentService(), configs: new ConfigCatalog(), audit: new SecurityAudit(),
  });
  const participant = async (ctx: Ctx) => sessions.authenticate(tokenOf(ctx));

  router.post(`${KSHVI_ROUTE_PREFIX}/auth/login`, async ctx => {
    const body = await ctx.json<{ username?: string; password?: string }>();
    if (!body.username || !body.password) throw new HttpError(422, 'invalid_credentials', 'Проверьте заполнение данных');
    const login = await sessions.login(body.username, body.password);
    return reply(200, { csrfToken: login.csrfToken, participant: publicParticipant(login.participant) }, { 'Set-Cookie': login.cookie });
  });

  router.get(`${KSHVI_ROUTE_PREFIX}/auth/me`, async ctx => publicParticipant(await participant(ctx)));

  router.post(`${KSHVI_ROUTE_PREFIX}/auth/role`, async ctx => {
    const token = tokenOf(ctx);
    const current = await sessions.authenticate(token);
    assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    const body = await ctx.json<{ roleId?: string }>();
    if (!body.roleId) throw new HttpError(422, 'invalid_role', 'Выберите назначенную роль');
    return publicParticipant(await sessions.selectRole(token, body.roleId));
  });

  router.post(`${KSHVI_ROUTE_PREFIX}/auth/logout`, async ctx => {
    const token = tokenOf(ctx);
    const current = await sessions.authenticate(token);
    assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    await sessions.revoke(token);
    return reply(204, null, { 'Set-Cookie': clearSessionCookie() });
  });

  registerExerciseRoutes(router, { store: exerciseStore, sessions });
  registerForceRoutes(router, forceStore);
  registerSymbolRoutes(router);
  registerInstanceRoutes(router, instances, commands);
  registerProjectionRoutes(router, projections, projectionWorld);
  registerSseRoutes(router, subscriptions);
  registerSealingRoutes(router, sealing);
  registerWorkflowRoutes(router, { sessions, workflow: integratedWorkflow });
  registerArchiveRoutes(router, { sessions, workflow: integratedWorkflow });
  if (exposition) registerExpositionRoutes(router, exposition);
  registerAdminRoutes(router, { sessions, admin: integratedAdmin });
  if (environmentProvider) addEnvironmentRoutes(router, environmentProvider);

  const match = router.match.bind(router);
  router.match = (method, path) => {
    const route = match(method, path);
    if (!route || route === 'method' || path === `${KSHVI_ROUTE_PREFIX}/auth/login`) return route;
    return {
      ...route,
      handler: async ctx => {
        const sessionOnly = path.startsWith(`${KSHVI_ROUTE_PREFIX}/auth/`);
        const organizationHint = sessionOnly || ctx.tenant === 'default' ? undefined : ctx.tenant;
        await sessions.authenticate(tokenOf(ctx), organizationHint);
        return route.handler(ctx);
      },
    };
  };
  return router;
}
