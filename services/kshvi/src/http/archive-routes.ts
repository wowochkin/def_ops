import { HttpError, Router, reply } from '@def-ops/service-kit';
import type { SessionManager } from '../auth/sessions';
import type { OfficialSessionService } from '../runtime/official-session-service';
import { KSHVI_ROUTE_PREFIX } from './router';
import { routeHandler, routeParticipant } from './route-auth';

export function registerArchiveRoutes(router: Router, options: { sessions: SessionManager; workflow: OfficialSessionService }): void {
  router.post(`${KSHVI_ROUTE_PREFIX}/archives`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, options.sessions, 'archive.export', true);
    const body = await ctx.json<{ exerciseId?: string; sessionId?: string }>();
    if (!body?.exerciseId || !body.sessionId) throw new HttpError(422, 'invalid_archive', 'Укажите учение и завершённый сеанс');
    return reply(201, await options.workflow.createArchive(actor, body.exerciseId, body.sessionId));
  }));
  router.get(`${KSHVI_ROUTE_PREFIX}/archives/:archiveId/export`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, options.sessions, 'archive.export');
    return options.workflow.archivePackage(actor, ctx.params.archiveId);
  }));
  router.get(`${KSHVI_ROUTE_PREFIX}/expositions/:archiveId`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, options.sessions, 'exercise:read');
    return options.workflow.exposition(actor, ctx.params.archiveId);
  }));
}
