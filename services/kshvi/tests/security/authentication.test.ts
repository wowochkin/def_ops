import { createService } from '@def-ops/service-kit';
import { expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { hashPassword, verifyPassword } from '../../src/auth/passwords';

const role = { id: 'leader-role', role: 'LEADER', sideId: 'blue', authorities: ['exercise:read'] };

it('требует сессию и организацию на API, командах и SSE, проверяет срок и отзыв', async () => {
  let now = new Date('2026-11-22T08:00:00.000Z');
  const store = new InMemorySessionStore();
  const sessions = new SessionManager({ store, now: () => now, ttlMs: 1000 });
  await sessions.createAccount({ userId: 'leader', username: 'leader', password: 'secret123', organizationId: 'org-1', roles: [role] });
  const login = await sessions.login('leader', 'secret123');
  await sessions.selectRole(login.token, role.id);
  const service = createService({ name: 'kshvi-security-test', port: 0, router: buildRouter({ sessions }) });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const authorized = { authorization: `Bearer ${login.token}`, 'x-tenant-id': 'org-1' };
  try {
    expect((await fetch(`${base}/kshvi/instances/instance-1/events`)).status).toBe(401);
    expect((await fetch(`${base}/kshvi/instances/instance-1/projection`)).status).toBe(401);
    expect((await fetch(`${base}/kshvi/instances`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/kshvi/exercises`, { headers: authorized })).status).toBe(200);
    expect((await fetch(`${base}/kshvi/exercises`, { headers: { ...authorized, 'x-tenant-id': 'org-2' } })).status).toBe(403);

    now = new Date('2026-11-22T08:00:02.000Z');
    expect((await fetch(`${base}/kshvi/exercises`, { headers: authorized })).status).toBe(401);
    now = new Date('2026-11-22T08:00:01.000Z');
    const second = await sessions.login('leader', 'secret123');
    await sessions.selectRole(second.token, role.id);
    const logout = await fetch(`${base}/kshvi/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${second.token}`, 'x-csrf-token': second.csrfToken },
    });
    expect(logout.status).toBe(204);
    expect((await fetch(`${base}/kshvi/auth/me`, { headers: { authorization: `Bearer ${second.token}` } })).status).toBe(401);
    expect(JSON.stringify(store.records())).not.toContain(second.token);
  } finally {
    await service.close();
  }
});

it('публичный справочник знаков и его страницы не требуют сессию КШВИ', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  const service = createService({ name: 'kshvi-public-symbols-test', port: 0, router: buildRouter({ sessions }) });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    expect((await fetch(`${base}/kshvi/symbols/catalog`)).status).toBe(200);
    const fragment = await fetch(`${base}/kshvi/symbols/fragments/doc-002-page-001`);
    expect(fragment.status).toBe(200);
    expect(fragment.headers.get('content-type')).toBe('image/jpeg');
    expect((await fragment.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await fetch(`${base}/kshvi/exercises`)).status).toBe(401);
  } finally {
    await service.close();
  }
});

it('хеширует пароли и не принимает открытый пароль как сохранённый хеш', async () => {
  const encoded = await hashPassword('secret123');
  expect(encoded).not.toContain('secret123');
  expect(encoded).toMatch(/^scrypt\$/);
  await expect(verifyPassword('secret123', encoded)).resolves.toBe(true);
  await expect(verifyPassword('secret123', 'secret123')).resolves.toBe(false);
});
