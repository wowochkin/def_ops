import { HttpError, type Ctx, type Handler } from '@def-ops/service-kit';
import { authorize, type ParticipantContext } from '../auth/authorize';
import { assertCsrf, type SessionManager } from '../auth/sessions';

export function routeToken(ctx: Ctx): string {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const pair = (ctx.req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  if (!pair) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return decodeURIComponent(pair.slice('kshvi_session='.length));
}

export async function routeParticipant(ctx: Ctx, sessions: SessionManager, action: string, mutation = false): Promise<ParticipantContext> {
  const participant = await sessions.authenticate(routeToken(ctx));
  authorize(participant, { action, organizationId: participant.organizationId });
  if (mutation) assertCsrf(participant, String(ctx.req.headers['x-csrf-token'] ?? ''));
  return participant;
}

export function routeHandler(handler: (ctx: Ctx) => Promise<unknown>): Handler {
  return async ctx => {
    try { return await handler(ctx); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('403') || message.includes('недоступ') || message.includes('Недостаточно')) throw new HttpError(403, 'forbidden', message);
      if (message.includes('не найден') || message.includes('отсутствует')) throw new HttpError(404, 'not_found', message);
      if (message.includes('ревизи') || message.includes('заверш') || message.includes('состоян')) throw new HttpError(409, 'state_conflict', message);
      throw new HttpError(422, 'invalid_request', message);
    }
  };
}
