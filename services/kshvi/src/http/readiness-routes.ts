import { Router, reply } from '@def-ops/service-kit';
import type { ReadinessAuthorization } from '../../../../packages/kshvi/src/forces/readiness';
import type { ReadinessStage } from '../../../../packages/kshvi/src/forces/readiness-stage';
import { KSHVI_ROUTE_PREFIX } from './router';
import type { ExerciseStore } from '../store/exercise-store';
import type { SessionManager } from '../auth/sessions';
import { ReadinessService, type ReadinessCommandInput } from '../preparation/readiness-service';
import { projectExerciseCard } from '../store/exercise-projection';
import { preparationExerciseId, preparationHandler, preparationParticipant } from './preparation-route-utils';

export function registerReadinessRoutes(router: Router, options: { store: ExerciseStore; sessions: SessionManager }) {
  const service = new ReadinessService(options.store);
  const base = `${KSHVI_ROUTE_PREFIX}/exercises/:id/readiness`;
  router.put(`${base}/stage`, preparationHandler(async ctx => {
    const actor = await preparationParticipant(ctx, options.sessions, 'exercise:revise', true);
    const body = await ctx.json<{ expectedRevision: number; stage: ReadinessStage }>();
    const card = await service.saveStage(actor, preparationExerciseId(ctx), body);
    return reply(200, projectExerciseCard(card, actor));
  }));
  router.post(`${base}/advance`, preparationHandler(async ctx => {
    const actor = await preparationParticipant(ctx, options.sessions, 'exercise:revise', true);
    const body = await ctx.json<ReadinessCommandInput>();
    const card = await service.advance(actor, preparationExerciseId(ctx), body);
    return reply(200, projectExerciseCard(card, actor));
  }));
  router.post(`${base}/partial-authorization`, preparationHandler(async ctx => {
    const actor = await preparationParticipant(ctx, options.sessions, 'exercise:revise', true);
    const body = await ctx.json<{ expectedRevision: number; decision: Omit<ReadinessAuthorization, 'actorRole' | 'authorities'> }>();
    const card = await service.authorizePartial(actor, preparationExerciseId(ctx), body);
    return reply(200, projectExerciseCard(card, actor));
  }));
  router.post(`${base}/rehearsal`, preparationHandler(async ctx => {
    const actor = await preparationParticipant(ctx, options.sessions, 'exercise:revise', true);
    const body = await ctx.json<Omit<ReadinessCommandInput, 'expectedRevision'>>();
    return service.rehearse(actor, preparationExerciseId(ctx), body);
  }));
}
