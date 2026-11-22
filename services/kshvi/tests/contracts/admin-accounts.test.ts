import { createPool, dropSchema } from '@def-ops/db';
import { createService } from '@def-ops/service-kit';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { PgSessionStore } from '../../src/auth/pg-session-store';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';

it('показывает и блокирует те же учётные записи, которые используются для входа', async () => {
  const store = new InMemorySessionStore();
  const sessions = new SessionManager({ store });
  await sessions.createAccount({ userId: 'admin-1', username: 'admin', password: 'secret123', organizationId: 'org-1', roles: [{ id: 'admin-role', role: 'TECH_ADMIN', sideId: null, authorities: ['kshvi:admin'] }] });
  await sessions.createAccount({ userId: 'user-1', username: 'user', password: 'secret123', organizationId: 'org-1', roles: [{ id: 'user-role', role: 'TRAINEE', sideId: 'blue', authorities: ['exercise:read'] }] });
  const service = createService({ name: 'kshvi-admin-contract', port: 0, router: buildRouter({ sessions }) });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}/kshvi`;
  async function login(username: string, roleId?: string) {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) });
    const body = await response.json() as { csrfToken?: string };
    const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    if (roleId && response.ok) await fetch(`${base}/auth/role`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': body.csrfToken!, Cookie: cookie }, body: JSON.stringify({ roleId }) });
    return { response, cookie, csrf: body.csrfToken ?? '' };
  }
  try {
    const admin = await login('admin', 'admin-role');
    expect(admin.response.status).toBe(200);
    const overviewResponse = await fetch(`${base}/admin/overview`, { headers: { Cookie: admin.cookie } });
    expect(overviewResponse.status).toBe(200);
    const overview = await overviewResponse.json() as { accounts: { userId: string; state: string }[] };
    expect(overview.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ userId: 'user-1', state: 'ACTIVE' })]));
    const blocked = await fetch(`${base}/admin/accounts/user-1/block`, { method: 'POST', headers: { Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf, 'Content-Type': 'application/json' }, body: '{}' });
    expect(blocked.status).toBe(200);
    expect((await login('user')).response.status).toBe(401);
    const archived = await fetch(`${base}/admin/accounts/user-1/archive`, { method: 'POST', headers: { Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf, 'Content-Type': 'application/json' }, body: '{}' });
    expect(archived.status).toBe(200);
    expect((await store.findAccountById('user-1'))?.state).toBe('ARCHIVED');
  } finally {
    await service.close();
  }
});

const databaseIntegration = process.env.TEST_DATABASE_URL ? it : it.skip;
databaseIntegration('PostgreSQL сохраняет смену состояния существующей учётной записи без дубликата', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!, 2);
  const schema = `kshvi_admin_test_${randomUUID().replaceAll('-', '')}`;
  const store = new PgSessionStore(pool, schema);
  const sessions = new SessionManager({ store });
  try {
    await store.init();
    await sessions.createAccount({ userId: 'user-1', username: 'user', password: 'secret123', organizationId: 'org-1', roles: [] });
    expect((await sessions.setAccountState('user-1', 'BLOCKED')).state).toBe('BLOCKED');
    expect((await sessions.setAccountState('user-1', 'ARCHIVED')).state).toBe('ARCHIVED');
    expect(await sessions.listAccounts('org-1')).toHaveLength(1);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
