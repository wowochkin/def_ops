import { HttpError, type Ctx, type Handler } from '@def-ops/service-kit';
import { authorize } from '../auth/authorize';
import { assertCsrf, type SessionManager } from '../auth/sessions';
import { ExerciseStoreError } from '../store/exercise-store';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function preparationExerciseId(ctx: Ctx): string {
  const id = ctx.params.id;
  if (!uuid.test(id)) throw new HttpError(404, 'not_found', 'Учение не найдено');
  return id;
}

export function preparationToken(ctx: Ctx): string {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const pair = (ctx.req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  if (!pair) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return decodeURIComponent(pair.slice('kshvi_session='.length));
}

export async function preparationParticipant(ctx: Ctx, sessions: SessionManager, action: string, mutation = false) {
  const current = await sessions.authenticate(preparationToken(ctx));
  authorize(current, { action, organizationId: current.organizationId, scope: 'organization' });
  if (mutation) assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
  return current;
}

export function preparationHandler(handler: (ctx: Ctx) => Promise<unknown>): Handler {
  return async ctx => {
    try { return await handler(ctx); }
    catch (error) {
      if (error instanceof ExerciseStoreError) {
        const status = error.code === 'VALIDATION' ? 422 : error.code === 'FORBIDDEN' ? 403
          : error.code === 'REVISION_CONFLICT' || error.code === 'SEALED_REQUIRED' ? 409 : 404;
        throw new HttpError(status, error.code.toLowerCase(), error.message);
      }
      if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(422, 'validation', error.message);
      throw error;
    }
  };
}
