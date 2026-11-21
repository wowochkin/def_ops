import type { Router } from '@def-ops/service-kit';
import type { SubscriptionService } from './subscription-service';

export function registerSseRoutes(router: Router, subscriptions: SubscriptionService): void {
  router.get('/kshvi/instances/:id/events', async ctx => {
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    ctx.res.write('retry: 1000\n\n');
    ctx.res.write(`event: ready\ndata: ${JSON.stringify({ type: 'ready', subscription: subscriptions.constructor.name })}\n\n`);
    ctx.res.end();
  });
}
