import { expect, it } from 'vitest';
import { HttpError, Reply, Router, type Ctx } from '@def-ops/service-kit';
import { buildTask52Router, withKshviHttpContracts } from '../src/http/contracts';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';

function ctx(): Ctx {
  return {
    req: { headers: {} } as Ctx['req'], res: {} as Ctx['res'], params: { id: 'd1' }, query: new URLSearchParams(),
    tenant: 'org1', requestId: 'corr-1', json: async <T,>() => ({} as T), text: async () => '',
  };
}

function handler(router: Router, method: string, path: string) {
  const match = router.match(method, path);
  if (!match || match === 'method') throw new Error(`Маршрут не найден: ${method} ${path}`);
  return match.handler;
}

it('возвращает kshviError и сохраняет whitelist-аудит успеха и отказа на реальных handlers', async () => {
  const audit: object[] = [];
  const router = new Router();
  router.get('/kshvi/documents/:id', async () => { throw new HttpError(403, 'forbidden', '403: скрытый объект secret'); });
  router.post('/kshvi/documents/:id/approve', async () => ({ status: 'approved' }));
  withKshviHttpContracts(router, {
    identify: async () => ({ userId: 'u1', organizationId: 'org1' }),
    audit: async record => { audit.push(record); },
  });
  const denied = await handler(router, 'GET', '/kshvi/documents/d1')(ctx());
  expect(denied).toBeInstanceOf(Reply);
  expect(denied).toMatchObject({
    status: 403,
    body: { error: { code: 'forbidden', message: 'Действие недоступно', correlationId: 'corr-1', fields: [], allowedActions: [] } },
  });
  expect(JSON.stringify(denied)).not.toContain('secret');

  const allowed = await handler(router, 'POST', '/kshvi/documents/d1/approve')(ctx());
  expect(allowed).toEqual({ status: 'approved' });
  expect(audit).toEqual([
    { actorId: 'u1', action: 'GET /kshvi/documents/:id', correlationId: 'corr-1', resourceId: 'd1', organizationId: 'org1', outcome: 'DENIED' },
    { actorId: 'u1', action: 'POST /kshvi/documents/:id/approve', correlationId: 'corr-1', resourceId: 'd1', organizationId: 'org1', outcome: 'ALLOWED' },
  ]);
  expect(JSON.stringify(audit)).not.toContain('secret');
});

it('обвязывает существующий app router для Task52 без изменения app.ts', async () => {
  const audit: object[] = [];
  const router = buildTask52Router({
    sessions: new SessionManager({ store: new InMemorySessionStore() }),
    audit: async record => { audit.push(record); },
  });
  const response = await handler(router, 'GET', '/kshvi/auth/me')(ctx());
  expect(response).toMatchObject({ status: 401, body: { error: { code: 'unauthorized', correlationId: 'corr-1' } } });
  expect(audit).toHaveLength(1);
});

it('не раскрывает внутреннюю ошибку и сохраняет RETRY_SAME_KEY только для 503', async () => {
  const router = new Router();
  router.get('/kshvi/failure', async () => { throw new Error('database password=secret'); });
  router.get('/kshvi/unavailable', async () => { throw new HttpError(503, 'temporary', 'подробность'); });
  withKshviHttpContracts(router, { audit: async () => undefined });
  const failure = await handler(router, 'GET', '/kshvi/failure')(ctx());
  expect(failure).toMatchObject({ status: 500, body: { error: { message: 'Внутренняя ошибка сервиса', correlationId: 'corr-1' } } });
  expect(JSON.stringify(failure)).not.toContain('secret');
  const unavailable = await handler(router, 'GET', '/kshvi/unavailable')(ctx());
  expect(unavailable).toMatchObject({ status: 503, body: { error: { allowedActions: ['RETRY_SAME_KEY'] } } });
});
