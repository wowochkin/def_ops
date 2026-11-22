import { HttpError, reply, type Ctx, type Handler, type Router } from '@def-ops/service-kit';
import type {
  ExpositionProgram,
  PresenterCommand,
} from '../../../../packages/kshvi/src/exposition/browser-entry';
import {
  ExpositionProjectorDeniedError,
  ExpositionSessionNotFoundError,
  type ExpositionSessionService,
} from '../exposition/exposition-session-service';

function guarded(handler: (ctx: Ctx) => Promise<unknown> | unknown): Handler {
  return async ctx => {
    try {
      return await handler(ctx);
    } catch (error) {
      if (error instanceof ExpositionSessionNotFoundError) throw new HttpError(404, 'exposition_not_found', error.message);
      if (error instanceof ExpositionProjectorDeniedError) throw new HttpError(403, 'projector_denied', error.message);
      if (error instanceof HttpError) throw error;
      if (error instanceof Error) throw new HttpError(422, 'exposition_rejected', error.message);
      throw error;
    }
  };
}

/** Регистратор для основного роутера Task52; app.ts в этом изменении не затрагивается. */
export function registerExpositionRoutes(router: Router, service: ExpositionSessionService): void {
  router.post('/kshvi/expositions', guarded(async ctx => service.start(await ctx.json())));
  router.get('/kshvi/expositions/:id/presenter', guarded(ctx => service.presenter(ctx.params.id)));
  router.post('/kshvi/expositions/:id/commands', guarded(async ctx => {
    const command = await ctx.json<PresenterCommand>();
    return service.command(ctx.params.id, command);
  }));
  router.post('/kshvi/expositions/:id/checkpoints/:checkpointId/continuations', guarded(async ctx => {
    const input = await ctx.json<Record<string, unknown>>() ?? {};
    return service.continueFromCheckpoint(ctx.params.id, ctx.params.checkpointId, input);
  }));
  router.post('/kshvi/expositions/:id/restarts', guarded(async ctx => {
    const input = await ctx.json<Parameters<ExpositionSessionService['restart']>[1]>();
    return service.restart(ctx.params.id, input);
  }));
  router.put('/kshvi/expositions/:id/program', guarded(async ctx => {
    return service.updateProgram(ctx.params.id, await ctx.json<ExpositionProgram>());
  }));
  router.get('/kshvi/expositions/:id/projector', guarded(ctx => {
    const projectorId = String(ctx.req.headers['x-projector-id'] ?? ctx.query.get('projectorId') ?? '');
    if (!projectorId) throw new ExpositionProjectorDeniedError('Укажите разрешённый проекторный профиль');
    return reply(200, service.projector(ctx.params.id, projectorId), { 'Cache-Control': 'no-store' });
  }));
  router.post('/kshvi/expositions/:id/exports', guarded(async ctx => {
    const input = await ctx.json<{ archiveId?: string }>() ?? {};
    return service.exportArchive(ctx.params.id, input.archiveId);
  }));
}
