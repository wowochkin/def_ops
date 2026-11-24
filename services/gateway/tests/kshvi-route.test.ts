import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { InMemorySessionStore, SessionManager } from '../../kshvi/src/auth/sessions';
import { buildRouter } from '../../kshvi/src/app';
import { createGateway, parseKeys } from '../src/gateway';

it('регистрирует КШВИ и порт 8105 в локальном запуске', () => {
  expect(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')).toContain('8105');
  expect(readFileSync(new URL('../../../scripts/dev-services.mjs', import.meta.url), 'utf8')).toContain("dir: 'services/kshvi'");
});

it('проводит вход, выбор роли и отзыв через шлюз без доверия организации клиента', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'u1', username: 'commander', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'role-1', role: 'TRAINEE', sideId: 'blue', authorities: ['document:read'] }],
  });
  const service = createService({ name: 'kshvi', port: 0, router: buildRouter({ sessions }) });
  const port = await service.listen();
  const gateway = createGateway({
    port: 0,
    services: { kshvi: `http://127.0.0.1:${port}` },
    routes: [['/api/kshvi', 'kshvi', '/kshvi']],
    auth: 'open', apiKeys: parseKeys(''), corsOrigin: '*',
  });
  await new Promise<void>(resolve => gateway.listen(0, resolve));
  try {
    const address = gateway.address();
    if (!address || typeof address === 'string') throw new Error('Нет порта шлюза');
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/kshvi/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'org2' },
      body: JSON.stringify({ username: 'commander', password: 'secret123', organizationId: 'org2', role: 'ADMIN' }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toContain('kshvi_session=');
    const loginBody = await login.json() as { csrfToken: string };
    const me = await fetch(`${base}/api/kshvi/auth/me`, { headers: { cookie: cookie ?? '', 'X-Tenant-Id': 'org2' } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ organizationId: 'org1', activeRole: null });
    const selected = await fetch(`${base}/api/kshvi/auth/role`, {
      method: 'POST', headers: { cookie: cookie ?? '', 'X-CSRF-Token': loginBody.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId: 'role-1' }),
    });
    expect(selected.status).toBe(200);
    const logout = await fetch(`${base}/api/kshvi/auth/logout`, { method: 'POST', headers: { cookie: cookie ?? '', 'X-CSRF-Token': loginBody.csrfToken } });
    expect(logout.status).toBe(204);
    expect((await fetch(`${base}/api/kshvi/auth/me`, { headers: { cookie: cookie ?? '' } })).status).toBe(401);
  } finally {
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await service.close();
  }
});
