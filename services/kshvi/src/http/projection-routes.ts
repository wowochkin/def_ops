import { HttpError, type Ctx, type Router } from '@def-ops/service-kit';
import type { ProjectionService } from '../instances/projection-service';
import type { ProjectableWorld } from '../../../../packages/kshvi/src/projections/project';
import type { VisibilityActor } from '../../../../packages/kshvi/src/projections/visibility-policy';

export type ServerProjectionActor = Omit<VisibilityActor, 'operationalAt'> & Readonly<{
  organizationId: string;
  instanceIds: readonly string[];
}>;
export type ProjectionAccessResolver = (ctx: Ctx, instanceId: string) => Promise<ServerProjectionActor>;

async function missingResolver(): Promise<never> {
  throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
}

export function registerProjectionRoutes(
  router: Router,
  projections: ProjectionService,
  world: ProjectableWorld,
  resolveActor: ProjectionAccessResolver = missingResolver,
): void {
  router.get('/kshvi/instances/:id/projection', async ctx => {
    const operationalAt = ctx.query.get('operationalAt');
    if (!operationalAt || !Number.isFinite(Date.parse(operationalAt))) {
      throw new HttpError(422, 'projection_context_required', 'Укажите корректное оперативное время');
    }
    const actor = await resolveActor(ctx, ctx.params.id);
    if (!actor.organizationId || !actor.instanceIds.includes(ctx.params.id) || !actor.side || !actor.role) {
      throw new HttpError(403, 'forbidden', '403: Действие недоступно');
    }
    try {
      // side, role, scope, authority, organization и demonstration приходят только из resolver.
      return projections.project(world, { ...actor, operationalAt });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('403:')) throw new HttpError(403, 'forbidden', error.message);
      throw error;
    }
  });
  router.get('/kshvi/instances/:id/search', async ctx => {
    const query = ctx.query.get('q')?.trim();
    if (!query) throw new HttpError(422, 'search_query_required', 'Укажите непустой поисковый запрос');
    const actor = await resolveActor(ctx, ctx.params.id);
    if (!actor.organizationId || !actor.instanceIds.includes(ctx.params.id) || !actor.side || !actor.role) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
    const operationalAt = ctx.query.get('operationalAt') ?? new Date().toISOString();
    return projections.search(world, { ...actor, operationalAt }, query);
  });
  router.get('/kshvi/instances/:id/export', async ctx => {
    const actor = await resolveActor(ctx, ctx.params.id);
    if (!actor.organizationId || !actor.instanceIds.includes(ctx.params.id) || !actor.side || !actor.role) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
    const operationalAt = ctx.query.get('operationalAt') ?? new Date().toISOString();
    return projections.export(world, { ...actor, operationalAt });
  });
  router.get('/kshvi/instances/:id/documents/:documentId/attachments/:attachmentId', async ctx => {
    const actor = await resolveActor(ctx, ctx.params.id);
    if (!actor.organizationId || !actor.instanceIds.includes(ctx.params.id) || !actor.side || !actor.role) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
    const operationalAt = ctx.query.get('operationalAt') ?? new Date().toISOString();
    try {
      return projections.attachment(world, { ...actor, operationalAt }, ctx.params.documentId, ctx.params.attachmentId);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('403:')) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
      throw error;
    }
  });
}
