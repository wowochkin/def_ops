import type { Router } from '@def-ops/service-kit';
import type { StartInstanceCommand } from '@def-ops/kshvi';
import type { SealingService } from '../instances/sealing-service';

export function registerSealingRoutes(router: Router, service: SealingService): void {
  router.post('/kshvi/sealing', async ctx => service.seal(await ctx.json()));
  router.post('/kshvi/sealing/:id/instances', async ctx => service.start(ctx.params.id, await ctx.json<StartInstanceCommand>()));
}
