import { HttpError, Router, reply, type Ctx, type Handler } from '@def-ops/service-kit';
import { authorize, type ParticipantContext } from '../auth/authorize';
import { assertCsrf, type SessionManager } from '../auth/sessions';
import {
  ExerciseStoreError,
  type CreateExerciseInput,
  type CreateRevisionInput,
  type CreateSessionInput,
  type ExerciseActor,
  type ExerciseFilters,
  type ExerciseStore,
} from '../store/exercise-store';
import { KSHVI_ROUTE_PREFIX } from './router';

const base = `${KSHVI_ROUTE_PREFIX}/exercises`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tokenOf(ctx: Ctx): string {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const pair = (ctx.req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  if (!pair) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return decodeURIComponent(pair.slice('kshvi_session='.length));
}

function translate(error: unknown): never {
  if (error instanceof ExerciseStoreError) {
    const status = error.code === 'VALIDATION' ? 422
      : error.code === 'REVISION_CONFLICT' || error.code === 'ARCHIVED' ? 409
        : 404;
    throw new HttpError(status, error.code.toLocaleLowerCase(), error.message);
  }
  throw error;
}

function exerciseId(ctx: Ctx, key = 'id'): string {
  const id = ctx.params[key];
  if (!uuid.test(id)) throw new HttpError(404, 'not_found', 'Учение не найдено');
  return id;
}

function filters(ctx: Ctx): ExerciseFilters {
  const state = ctx.query.get('state');
  const scale = ctx.query.get('scale');
  const purpose = ctx.query.get('purpose');
  if (state && !['DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED', 'CANCELLED', 'ARCHIVED'].includes(state)) {
    throw new HttpError(422, 'invalid_filter', 'Проверьте фильтр состояния');
  }
  if (scale && !['tactical', 'operational', 'strategic', 'custom'].includes(scale)) {
    throw new HttpError(422, 'invalid_filter', 'Проверьте фильтр масштаба');
  }
  if (purpose && !['planned', 'special', 'inspection', 'research', 'exposition', 'custom'].includes(purpose)) {
    throw new HttpError(422, 'invalid_filter', 'Проверьте фильтр назначения');
  }
  return {
    query: ctx.query.get('query') ?? undefined,
    state: state as ExerciseFilters['state'] ?? undefined,
    scale: scale as ExerciseFilters['scale'] ?? undefined,
    purpose: purpose as ExerciseFilters['purpose'] ?? undefined,
    includeArchived: ctx.query.get('includeArchived') === 'true',
  };
}

export function registerExerciseRoutes(router: Router, options: { store: ExerciseStore; sessions: SessionManager }): void {
  const { store, sessions } = options;
  const participant = async (ctx: Ctx, action: string, mutation = false): Promise<ExerciseActor & { participant: ParticipantContext }> => {
    const current = await sessions.authenticate(tokenOf(ctx));
    authorize(current, { action, organizationId: current.organizationId, scope: 'organization' });
    if (mutation) assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    return { organizationId: current.organizationId, userId: current.userId, participant: current };
  };
  const handle = (handler: (ctx: Ctx) => Promise<unknown>): Handler => async ctx => {
    try { return await handler(ctx); } catch (error) { translate(error); }
  };

  router.get(base, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:read');
    return { items: await store.list(actor.organizationId, filters(ctx)) };
  }));

  router.post(base, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:create', true);
    const body = await ctx.json<CreateExerciseInput>();
    return reply(201, await store.create(actor, body));
  }));

  router.get(`${base}/:id`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:read');
    const card = await store.get(actor.organizationId, exerciseId(ctx));
    if (!card) throw new HttpError(404, 'not_found', 'Учение не найдено');
    return card;
  }));

  router.post(`${base}/:id/copies`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:copy', true);
    const body = await ctx.json<{ title?: string }>() ?? {};
    return reply(201, await store.copy(actor, exerciseId(ctx), body.title));
  }));

  router.post(`${base}/:id/archive`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:archive', true);
    const body = await ctx.json<{ expectedRevision?: number }>() ?? {};
    return store.archive(actor, exerciseId(ctx), body.expectedRevision as number);
  }));

  router.get(`${base}/:id/revisions`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:read');
    const card = await store.get(actor.organizationId, exerciseId(ctx));
    if (!card) throw new HttpError(404, 'not_found', 'Учение не найдено');
    return { items: card.revisions };
  }));

  router.post(`${base}/:id/revisions`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:revise', true);
    const body = await ctx.json<CreateRevisionInput>();
    return reply(201, await store.createRevision(actor, exerciseId(ctx), body));
  }));

  router.get(`${base}/:id/sessions`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:read');
    return { items: await store.listSessions(actor.organizationId, exerciseId(ctx)) };
  }));

  router.post(`${base}/:id/sessions`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:conduct', true);
    const body = await ctx.json<CreateSessionInput>();
    return reply(201, await store.createSession(actor, exerciseId(ctx), body));
  }));

  router.get(`${base}/:id/sessions/:sessionId`, handle(async ctx => {
    const actor = await participant(ctx, 'exercise:read');
    const session = await store.getSession(actor.organizationId, exerciseId(ctx), exerciseId(ctx, 'sessionId'));
    if (!session) throw new HttpError(404, 'not_found', 'Сеанс не найден');
    return session;
  }));
}
