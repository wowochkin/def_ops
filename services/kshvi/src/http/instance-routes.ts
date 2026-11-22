import { HttpError, type Ctx, type Router } from '@def-ops/service-kit';
import type { InstanceService, StartInstanceInput } from '../instances/instance-service';
import type { CommandService } from '../instances/command-service';
import type { ParticipantContext } from '../auth/authorize';

async function missingResolver(): Promise<never> {
  throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
}

export function registerInstanceRoutes(
  router: Router,
  instances: InstanceService,
  commands: CommandService,
  resolveActor: (ctx: Ctx) => Promise<ParticipantContext> = missingResolver,
): void {
  router.post('/kshvi/instances', async ctx => instances.startInstance(await ctx.json<StartInstanceInput>(), await resolveActor(ctx)));
  router.post('/kshvi/instances/:id/commands', async ctx => commands.execute({ ...(await ctx.json()), instanceId: ctx.params.id }));
}
