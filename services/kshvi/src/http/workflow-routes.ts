import { HttpError, Router, type Ctx } from '@def-ops/service-kit';
import type { SessionManager } from '../auth/sessions';
import { OfficialSessionService } from '../runtime/official-session-service';
import type { SessionCommand } from '../store/exercise-store';
import { KSHVI_ROUTE_PREFIX } from './router';
import { routeHandler, routeParticipant } from './route-auth';

const base = `${KSHVI_ROUTE_PREFIX}/exercises/:id/sessions/:sessionId`;
const perspective = (ctx: Ctx): 'PARTICIPANT' | 'TRUTH' => {
  const value = ctx.query.get('perspective') ?? 'PARTICIPANT';
  if (value !== 'PARTICIPANT' && value !== 'TRUTH') throw new HttpError(422, 'invalid_perspective', 'Выберите перспективу PARTICIPANT или TRUTH');
  return value;
};

export function registerWorkflowRoutes(router: Router, options: { sessions: SessionManager; workflow: OfficialSessionService }): void {
  const { sessions, workflow } = options;
  router.post(`${base}/commands`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, sessions, 'exercise:conduct', true);
    const body = await ctx.json<{ command?: SessionCommand; expectedRevision?: number; idempotencyKey?: string }>();
    if (!body?.command || !Number.isSafeInteger(body.expectedRevision) || !body.idempotencyKey) throw new HttpError(422, 'invalid_command', 'Проверьте команду, ревизию и идемпотентный ключ');
    return workflow.command(actor, ctx.params.id, ctx.params.sessionId, { command: body.command, expectedRevision: body.expectedRevision!, idempotencyKey: body.idempotencyKey });
  }));

  router.get(`${base}/projection`, routeHandler(async ctx => {
    const selected = perspective(ctx);
    const actor = await routeParticipant(ctx, sessions, selected === 'TRUTH' ? 'TRUTH_READ' : 'exercise:read');
    return workflow.projection(actor, ctx.params.id, ctx.params.sessionId, selected);
  }));

  router.get(`${base}/replay`, routeHandler(async ctx => {
    const selected = perspective(ctx);
    const actor = await routeParticipant(ctx, sessions, selected === 'TRUTH' ? 'TRUTH_READ' : 'exercise:read');
    const cursor = Number(ctx.query.get('cursor') ?? '0');
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(422, 'invalid_cursor', 'Курсор реплея должен быть неотрицательным целым');
    return workflow.replayFrame(actor, ctx.params.id, ctx.params.sessionId, cursor, selected);
  }));

  router.get(`${base}/debrief`, routeHandler(async ctx => {
    const scope = ctx.query.get('scope') ?? 'PRIVATE';
    if (scope !== 'GENERAL' && scope !== 'PRIVATE') throw new HttpError(422, 'invalid_scope', 'Выберите общий или частный разбор');
    const actor = await routeParticipant(ctx, sessions, scope === 'GENERAL' ? 'TRUTH_READ' : 'exercise:read');
    return workflow.buildDebrief(actor, ctx.params.id, ctx.params.sessionId, scope);
  }));

  router.post(`${base}/debrief/assessment`, routeHandler(async ctx => {
    const actor = await routeParticipant(ctx, sessions, 'TRUTH_READ', true);
    const body = await ctx.json<{ finalAssessment?: string; comment?: string; idempotencyKey?: string }>();
    if (!body?.finalAssessment?.trim() || !body.comment?.trim() || !body.idempotencyKey) throw new HttpError(422, 'invalid_assessment', 'Итоговая оценка, комментарий и идемпотентный ключ обязательны');
    return workflow.approveDebriefAssessment(actor, ctx.params.id, ctx.params.sessionId, { finalAssessment: body.finalAssessment, comment: body.comment, idempotencyKey: body.idempotencyKey });
  }));
}
