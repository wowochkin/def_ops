import { Router } from '@def-ops/service-kit';
import type { SessionManager } from '../auth/sessions';
import type { AdminOverviewService } from '../admin/admin-overview-service';
import { KSHVI_ROUTE_PREFIX } from './router';
import { routeHandler, routeParticipant } from './route-auth';

export function registerAdminRoutes(router: Router, options: { sessions: SessionManager; admin: AdminOverviewService }): void {
  const base = `${KSHVI_ROUTE_PREFIX}/admin`;
  router.get(`${base}/overview`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, options.sessions, 'kshvi:admin');
    return await options.admin.overview(actor);
  }));
  for (const action of ['block', 'archive'] as const) {
    router.post(`${base}/accounts/:accountId/${action}`, routeHandler(async ctx => {
      await routeParticipant(ctx, options.sessions, 'kshvi:admin', true);
      return action === 'block'
        ? await options.admin.options.directory.blockAccount(ctx.params.accountId)
        : await options.admin.options.directory.archiveAccount(ctx.params.accountId);
    }));
  }
  router.post(`${base}/assignments/:assignmentId/revoke`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, options.sessions, 'assignment.manage', true);
    return options.admin.options.assignments.revoke({ userId: actor.userId, organizationId: actor.organizationId, domainPermissions: actor.authorities }, ctx.params.assignmentId);
  }));
  router.post(`${base}/audit/export`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, options.sessions, 'kshvi:admin', true);
    return { items: options.admin.options.audit.export({ userId: actor.userId, organizationId: actor.organizationId, technicalPermissions: actor.authorities }, ctx.requestId) };
  }));
}
