import { HttpError, type Ctx, type Router } from '@def-ops/service-kit';
import type { SubscriptionActor, SubscriptionService } from './subscription-service';

export type SseAccessResolver = (ctx: Ctx, instanceId: string) => Promise<SubscriptionActor>;
async function missingResolver(): Promise<never> {
  throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
}

function assertAccess(actor: SubscriptionActor, instanceId: string): void {
  if (!actor.organizationId || !actor.instanceIds?.includes(instanceId) || !actor.side || !actor.role) {
    throw new HttpError(403, 'forbidden', '403: Действие недоступно');
  }
}

function sameRights(left: SubscriptionActor, right: SubscriptionActor): boolean {
  const normalize = (actor: SubscriptionActor) => ({
    organizationId: actor.organizationId,
    instanceIds: [...(actor.instanceIds ?? [])].sort(),
    side: actor.side,
    role: actor.role,
    scope: actor.scope,
    authorities: [...(actor.authorities ?? [])].sort(),
    nodeId: actor.nodeId,
    demonstration: actor.demonstration,
    subscriptionRevision: actor.subscriptionRevision ?? 0,
  });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function writeEvent(ctx: Ctx, event: string, data: unknown, id?: number): void {
  if (ctx.res.writableEnded || ctx.res.destroyed) return;
  if (id !== undefined) ctx.res.write(`id: ${id}\n`);
  ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function registerSseRoutes(router: Router, subscriptions: SubscriptionService, resolveActor: SseAccessResolver = missingResolver): void {
  router.get('/kshvi/instances/:id/events', async ctx => {
    const instanceId = ctx.params.id;
    let actor = await resolveActor(ctx, instanceId);
    assertAccess(actor, instanceId);
    const lastEventId = ctx.req.headers['last-event-id'];
    let after = 0;
    if (typeof lastEventId === 'string' && lastEventId.trim()) {
      after = /^\d+$/.test(lastEventId) ? Number(lastEventId) : subscriptions.sequenceOf(instanceId, lastEventId) ?? Number.NaN;
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new HttpError(409, 'snapshot_required', 'Требуется новый снимок проекции');
      }
    }
    const requestedPolicy = Number(ctx.req.headers['x-policy-revision'] ?? ctx.query.get('policyRevision') ?? actor.subscriptionRevision ?? 0);
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    ctx.res.write('retry: 1000\n\n');
    if (requestedPolicy !== (actor.subscriptionRevision ?? 0)) {
      writeEvent(ctx, 'snapshot', { type: 'snapshot.required', reason: 'POLICY_CHANGED' });
      ctx.res.end();
      return;
    }
    const minimum = subscriptions.minSequence(instanceId);
    if (minimum > after + 1) {
      writeEvent(ctx, 'snapshot', { type: 'snapshot.required', reason: 'SEQUENCE_GAP' });
      ctx.res.end();
      return;
    }
    writeEvent(ctx, 'ready', { type: 'ready', fromSequence: after + 1, policyRevision: actor.subscriptionRevision ?? 0 });
    const abort = new AbortController();
    const stop = () => abort.abort();
    ctx.req.on('close', stop);
    ctx.res.on('close', stop);
    try {
      while (!abort.signal.aborted && !ctx.res.writableEnded) {
        try {
          const current = await resolveActor(ctx, instanceId);
          assertAccess(current, instanceId);
          if (!sameRights(actor, current)) {
            writeEvent(ctx, 'revoked', { type: 'subscription.revoked' });
            ctx.res.end();
            return;
          }
          actor = current;
        } catch {
          writeEvent(ctx, 'revoked', { type: 'subscription.revoked' });
          ctx.res.end();
          return;
        }
        const events = subscriptions.after(instanceId, after);
        for (const event of events) {
          try {
            const current = await resolveActor(ctx, instanceId);
            assertAccess(current, instanceId);
            if (!sameRights(actor, current)) {
              writeEvent(ctx, 'revoked', { type: 'subscription.revoked' });
              ctx.res.end();
              return;
            }
            actor = current;
          } catch {
            writeEvent(ctx, 'revoked', { type: 'subscription.revoked' });
            ctx.res.end();
            return;
          }
          if (event.organizationId && event.organizationId !== actor.organizationId) {
            after = event.sequence;
            continue;
          }
          const payload = subscriptions.payloadFor(event, actor);
          writeEvent(ctx, 'message', payload, event.sequence);
          after = event.sequence;
        }
        if (!events.length) await subscriptions.waitForChange(instanceId, after, abort.signal, 1000);
      }
    } finally {
      ctx.req.off('close', stop);
      ctx.res.off('close', stop);
      if (!ctx.res.writableEnded) ctx.res.end();
    }
  });
}
