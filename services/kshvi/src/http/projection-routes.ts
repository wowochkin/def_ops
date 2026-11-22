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
}
