import { HttpError, type Ctx, type Router } from '@def-ops/service-kit';
import type { InstanceService, StartInstanceInput } from '../instances/instance-service';
import type { CommandService } from '../instances/command-service';
import { authorize, type ParticipantContext } from '../auth/authorize';
import { assertCsrf } from '../auth/sessions';
import type { InstanceCommand } from '../instances/command-service';

async function missingResolver(): Promise<never> {
  throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
}

export function registerInstanceRoutes(
  router: Router,
  instances: InstanceService,
  commands: CommandService,
  resolveActor: (ctx: Ctx) => Promise<ParticipantContext> = missingResolver,
): void {
  const actor = async (ctx: Ctx, action: string): Promise<ParticipantContext> => {
    const current = await resolveActor(ctx);
    authorize(current, { action, organizationId: current.organizationId, scope: 'organization' });
    if (ctx.req.headers.cookie) assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    return current;
  };
  router.post('/kshvi/instances', async ctx => instances.startInstance(await ctx.json<StartInstanceInput>(), await actor(ctx, 'instance:start')));
  router.post('/kshvi/instances/:id/commands', async ctx => {
    const current = await actor(ctx, 'instance:command');
    const body = await ctx.json<Partial<InstanceCommand>>();
    return commands.execute({
      ...body,
      instanceId: ctx.params.id,
      actor: {
        userId: current.userId,
        organizationId: current.organizationId,
        role: current.activeRole ?? 'UNKNOWN',
        ...(current.sideId ? { sideId: current.sideId } : {}),
        assignedNodeIds: current.assignedNodeIds ?? [],
      },
    } as InstanceCommand);
  });
}
