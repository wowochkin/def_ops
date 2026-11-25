import { Router, reply } from '@def-ops/service-kit';
import type { AutonomyProfile } from '@def-ops/kshvi-events';
import { KSHVI_ROUTE_PREFIX } from './router';
import type { ExerciseStore } from '../store/exercise-store';
import type { SessionManager } from '../auth/sessions';
import { AutonomyService } from '../preparation/autonomy-service';
import { projectExerciseCard } from '../store/exercise-projection';
import { preparationExerciseId, preparationHandler, preparationParticipant } from './preparation-route-utils';

export function registerAutonomyRoutes(router: Router, options: { store: ExerciseStore; sessions: SessionManager }) {
  const service = new AutonomyService(options.store);
  const base = `${KSHVI_ROUTE_PREFIX}/exercises/:id/autonomy`;
  router.get(`${base}/catalog`, preparationHandler(async ctx => {
    const actor = await preparationParticipant(ctx, options.sessions, 'exercise:read');
    return service.describe(actor, preparationExerciseId(ctx));
  }));
  router.put(`${base}/profile`, preparationHandler(async ctx => {
    const actor = await preparationParticipant(ctx, options.sessions, 'exercise:revise', true);
    const body = await ctx.json<{ expectedRevision: number; profile: AutonomyProfile }>();
    const card = await service.saveProfile(actor, preparationExerciseId(ctx), body);
    return reply(200, projectExerciseCard(card, actor));
  }));
  router.post(`${base}/rehearsal`, preparationHandler(async ctx => {
    const actor = await preparationParticipant(ctx, options.sessions, 'exercise:revise', true);
    const body = await ctx.json<{ seeds: readonly string[]; fromSecond: number; toSecond: number }>();
    return service.rehearse(actor, preparationExerciseId(ctx), body);
  }));
}
