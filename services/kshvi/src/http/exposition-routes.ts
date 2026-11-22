import { HttpError, reply, type Ctx, type Handler, type Router } from '@def-ops/service-kit';
import type {
  ExpositionProgram,
  PresenterCommand,
} from '../../../../packages/kshvi/src/exposition/browser-entry';
import { authorize } from '../auth/authorize';
import { assertCsrf, type SessionManager } from '../auth/sessions';
import {
  ExpositionProjectorDeniedError,
  ExpositionSessionNotFoundError,
  type ExpositionActor,
  type ExpositionSessionService,
} from '../exposition/exposition-session-service';
import { ExpositionSessionConflictError } from '../exposition/exposition-repository';

const PRESENTER_ROLES = new Set(['DIRECTOR', 'PRESENTER']);
const PROJECTOR_ROLES = new Set(['AUDIENCE_PROJECTOR']);

function tokenOf(ctx: Ctx): string {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const pair = (ctx.req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  if (!pair) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return decodeURIComponent(pair.slice('kshvi_session='.length));
}

function guarded(handler: (ctx: Ctx) => Promise<unknown> | unknown): Handler {
  return async ctx => {
    try {
      return await handler(ctx);
    } catch (error) {
      if (error instanceof ExpositionSessionNotFoundError) throw new HttpError(404, 'exposition_not_found', error.message);
      if (error instanceof ExpositionProjectorDeniedError) throw new HttpError(403, 'projector_denied', error.message);
      if (error instanceof ExpositionSessionConflictError) throw new HttpError(409, 'exposition_session_conflict', error.message);
      if (error instanceof HttpError) throw error;
      if (error instanceof Error) throw new HttpError(422, 'exposition_rejected', error.message);
      throw error;
    }
  };
}

export function registerExpositionRoutes(router: Router, options: {
  service: ExpositionSessionService;
  sessions: SessionManager;
}): void {
  const { service, sessions } = options;
  const actor = async (ctx: Ctx, action: string, roles: ReadonlySet<string>, mutation = false): Promise<ExpositionActor> => {
    const current = await sessions.authenticate(tokenOf(ctx));
    authorize(current, { action, organizationId: current.organizationId });
    if (!current.activeRole || !roles.has(current.activeRole)) throw new HttpError(403, 'forbidden', '403: Действие недоступно для этой роли');
    if (mutation) assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    return { organizationId: current.organizationId, userId: current.userId };
  };
  const presenter = (ctx: Ctx, action = 'exposition:present', mutation = false) => actor(ctx, action, PRESENTER_ROLES, mutation);
  const projector = (ctx: Ctx) => actor(ctx, 'exposition:project', PROJECTOR_ROLES);

  router.post('/kshvi/expositions', guarded(async ctx => {
    const current = await presenter(ctx, 'exposition:present', true);
    return service.start(current, await ctx.json());
  }));
  router.get('/kshvi/expositions/active/projector', guarded(async ctx => {
    const current = await projector(ctx);
    return reply(200, await service.activeProjector(current), { 'Cache-Control': 'no-store' });
  }));
  router.get('/kshvi/expositions/:id/presenter-projection', guarded(async ctx => {
    const current = await presenter(ctx);
    return reply(200, await service.presenterProjection(current, ctx.params.id), { 'Cache-Control': 'no-store' });
  }));
  router.get('/kshvi/expositions/:id/presenter', guarded(async ctx => {
    const current = await presenter(ctx);
    return service.presenter(current, ctx.params.id);
  }));
  router.post('/kshvi/expositions/:id/commands', guarded(async ctx => {
    const current = await presenter(ctx, 'exposition:present', true);
    return service.command(current, ctx.params.id, await ctx.json<PresenterCommand>());
  }));
  router.post('/kshvi/expositions/:id/checkpoints/:checkpointId/continuations', guarded(async ctx => {
    const current = await presenter(ctx, 'exposition:present', true);
    const input = await ctx.json<Parameters<ExpositionSessionService['continueFromCheckpoint']>[3]>() ?? {};
    return service.continueFromCheckpoint(current, ctx.params.id, ctx.params.checkpointId, input);
  }));
  router.post('/kshvi/expositions/:id/restarts', guarded(async ctx => {
    const current = await presenter(ctx, 'exposition:present', true);
    const input = await ctx.json<Parameters<ExpositionSessionService['restart']>[2]>();
    return service.restart(current, ctx.params.id, input);
  }));
  router.put('/kshvi/expositions/:id/program', guarded(async ctx => {
    const current = await presenter(ctx, 'exposition:edit', true);
    return service.updateProgram(current, ctx.params.id, await ctx.json<ExpositionProgram>());
  }));
  router.get('/kshvi/expositions/:id/projector', guarded(async ctx => {
    const current = await projector(ctx);
    return reply(200, await service.projector(current, ctx.params.id), { 'Cache-Control': 'no-store' });
  }));
  router.post('/kshvi/expositions/:id/exports', guarded(async ctx => {
    const current = await presenter(ctx, 'exposition:export', true);
    const input = await ctx.json<{ archiveId?: string }>() ?? {};
    return service.exportArchive(current, ctx.params.id, input.archiveId);
  }));
}
