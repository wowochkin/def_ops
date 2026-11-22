import { HttpError, type Ctx, type Router } from '@def-ops/service-kit';
import type { InstanceService, StartInstanceInput } from '../instances/instance-service';
import type { CommandService, InstanceCommand } from '../instances/command-service';
import { authorize, type ParticipantContext } from '../auth/authorize';
import { assertCsrf } from '../auth/sessions';
import type { CartographyEnvironmentProvider } from '../environment/cartography-provider';
import { weatherAtConductWorld } from '../instances/weather-service';

async function missingResolver(): Promise<never> {
  throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
}
function commandActor(current: ParticipantContext): InstanceCommand['actor'] {
  return {
    userId: current.userId,
    organizationId: current.organizationId,
    role: current.activeRole ?? 'UNKNOWN',
    ...(current.sideId ? { sideId: current.sideId } : {}),
    assignedNodeIds: current.assignedNodeIds ?? [],
  };
}
function coordinate(query: URLSearchParams, key: 'lon' | 'lat'): number {
  const raw = query.get(key);
  const value = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  const valid = Number.isFinite(value) && (key === 'lon' ? value >= -180 && value <= 180 : value >= -90 && value <= 90);
  if (!valid) throw new HttpError(422, 'invalid_coordinates', `Укажите корректную координату ${key}`);
  return value;
}

export function registerInstanceRoutes(
  router: Router,
  instances: InstanceService,
  commands: CommandService,
  resolveActor: (ctx: Ctx) => Promise<ParticipantContext> = missingResolver,
  environmentProvider?: CartographyEnvironmentProvider,
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
    return commands.execute({ ...body, instanceId: ctx.params.id, actor: commandActor(current) } as InstanceCommand);
  });
  router.post('/kshvi/instances/:id/environment', async ctx => {
    if (!environmentProvider) throw new HttpError(503, 'environment_unavailable', 'Серверное хранилище среды не настроено');
    const current = await actor(ctx, 'instance:command');
    const body = await ctx.json<{ branchId?: string; expectedRevision?: number; idempotencyKey?: string; snapshotId?: string }>();
    if (!body.snapshotId || !body.idempotencyKey || !Number.isSafeInteger(body.expectedRevision)) {
      throw new HttpError(422, 'invalid_environment_binding', 'Укажите snapshotId, ревизию и идемпотентный ключ');
    }
    const snapshot = await environmentProvider.loadSnapshot(body.snapshotId);
    return commands.execute({
      instanceId: ctx.params.id, branchId: body.branchId ?? 'main', expectedRevision: body.expectedRevision!, idempotencyKey: body.idempotencyKey,
      type: 'environment.bind', at: new Date().toISOString(), actor: commandActor(current), payload: { snapshot },
    });
  });
  router.get('/kshvi/instances/:id/weather', async ctx => {
    if (!environmentProvider) throw new HttpError(503, 'environment_unavailable', 'Серверное хранилище среды не настроено');
    await actor(ctx, 'projection:read');
    const operationalAt = ctx.query.get('operationalAt');
    if (!operationalAt || !Number.isFinite(Date.parse(operationalAt))) throw new HttpError(422, 'operational_time_required', 'Укажите оперативное время погоды');
    const world = commands.state(ctx.params.id, ctx.query.get('branchId') ?? 'main').world;
    return weatherAtConductWorld(world, environmentProvider, {
      lon: coordinate(ctx.query, 'lon'), lat: coordinate(ctx.query, 'lat'), operationalAt,
      ...(ctx.query.get('wallClockAt') ? { wallClockAt: ctx.query.get('wallClockAt')! } : {}),
      ...(ctx.query.get('playbackRate') ? { playbackRate: Number(ctx.query.get('playbackRate')) } : {}),
    });
  });
}
