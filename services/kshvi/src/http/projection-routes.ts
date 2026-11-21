import { HttpError, type Router } from '@def-ops/service-kit';
import type { ProjectionService } from '../instances/projection-service';
import type { ProjectableWorld } from '../../../../packages/kshvi/src/projections/project';

export function registerProjectionRoutes(router: Router, projections: ProjectionService, world: ProjectableWorld): void {
  router.get('/kshvi/instances/:id/projection', async ctx => {
    const side = ctx.query.get('side');
    const role = ctx.query.get('role');
    const operationalAt = ctx.query.get('operationalAt');
    if (!side || !role || !operationalAt) throw new HttpError(422, 'projection_context_required', 'Укажите сторону, роль и оперативное время');
    const scope = ctx.query.get('scope') === 'truth' ? 'truth' as const : 'own' as const;
    const authorities = ctx.query.getAll('authority');
    return projections.project(world, { side, role, operationalAt, scope, authorities, demonstration: ctx.query.get('demonstration') === '1' });
  });
}
