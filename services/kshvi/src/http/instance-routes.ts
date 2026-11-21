import type { Router } from '@def-ops/service-kit';
import type { InstanceService } from '../instances/instance-service';
import type { CommandService } from '../instances/command-service';

export function registerInstanceRoutes(router: Router, instances: InstanceService, commands: CommandService): void {
  router.post('/kshvi/instances', async ctx => instances.startInstance(await ctx.json()));
  router.post('/kshvi/instances/:id/commands', async ctx => commands.execute({ ...(await ctx.json()), instanceId: ctx.params.id }));
}
