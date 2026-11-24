import { HttpError, type Ctx, type Router } from '@def-ops/service-kit';
import type { StartInstanceCommand } from '@def-ops/kshvi';
import type { SealingService } from '../instances/sealing-service';
import type { ParticipantContext } from '../auth/authorize';
import { assertCsrf } from '../auth/sessions';

export type SealingAccessResolver = (ctx: Ctx) => Promise<ParticipantContext>;
async function missingResolver(): Promise<never> {
  throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
}

export function registerSealingRoutes(router: Router, service: SealingService, resolveActor: SealingAccessResolver = missingResolver): void {
  const actor = async (ctx: Ctx): Promise<ParticipantContext> => {
    const current = await resolveActor(ctx);
    // Cookie-сессия требует CSRF; Bearer канал использует явный серверный token resolver.
    if (ctx.req.headers.cookie) assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    return current;
  };
  router.post('/kshvi/sealing', async ctx => service.seal(await ctx.json(), await actor(ctx)));
  router.post('/kshvi/sealing/:id/instances', async ctx => {
    const body = await ctx.json<StartInstanceCommand>();
    return service.start(ctx.params.id, body, await actor(ctx));
  });
}
