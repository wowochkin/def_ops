import { expect, it } from 'vitest';
import {
  InMemorySessionStore,
  SessionManager,
  assertCsrf,
  auditRecord,
  authorize,
  hashPassword,
  kshviError,
  sessionCookie,
  verifyPassword,
} from '../src/index';

const role = { id: 'role-1', role: 'TRAINEE', sideId: 'blue', authorities: ['document:read'] };

it('не принимает роль из тела запроса и не раскрывает скрытый объект', () => {
  const actor = { userId: 'u1', activeRole: 'TRAINEE', sideId: 'blue', organizationId: 'org1', authorities: ['document:read'] } as const;
  expect(() => authorize(actor, { action: 'document:approve', sideId: 'red', objectExists: true })).toThrow('403');
  expect(kshviError(403, 'forbidden', 'u1')).toMatchObject({ status: 403, body: { error: { message: 'Действие недоступно', correlationId: 'u1' } } });
  expect(JSON.stringify(kshviError(403, 'forbidden', 'u1'))).not.toContain('objectExists');
});

it('хеширует пароль scrypt с индивидуальной солью', async () => {
  const first = await hashPassword('correct horse');
  const second = await hashPassword('correct horse');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^scrypt\$/);
  await expect(verifyPassword('correct horse', first)).resolves.toBe(true);
  await expect(verifyPassword('wrong', first)).resolves.toBe(false);
});

it('хранит только хеши токенов, выбирает назначенную роль и отзывает сессию', async () => {
  const store = new InMemorySessionStore();
  const sessions = new SessionManager({ store, now: () => new Date('2026-01-01T00:00:00Z') });
  await sessions.createAccount({ userId: 'u1', username: 'user', password: 'secret123', organizationId: 'org1', roles: [role] });
  const login = await sessions.login('user', 'secret123');
  expect(JSON.stringify(store.records())).not.toContain(login.token);
  expect(JSON.stringify(store.records())).not.toContain(login.csrfToken);
  expect(login.cookie).toContain('HttpOnly');
  expect(login.cookie).toContain('Secure');
  expect(login.cookie).toContain('SameSite=Strict');
  await expect(sessions.selectRole(login.token, 'unknown')).rejects.toThrow('403');
  const participant = await sessions.selectRole(login.token, 'role-1');
  expect(participant).toMatchObject({ organizationId: 'org1', activeRole: 'TRAINEE', sideId: 'blue' });
  await expect(sessions.authenticate(login.token, 'org2')).rejects.toThrow('403');
  expect(() => assertCsrf(participant, login.csrfToken)).not.toThrow();
  expect(() => assertCsrf(participant, 'wrong')).toThrow('403');
  await sessions.revoke(login.token);
  await expect(sessions.authenticate(login.token)).rejects.toThrow('401');
});

it('отклоняет истёкшую сессию на следующем запросе', async () => {
  let now = new Date('2026-01-01T00:00:00Z');
  const sessions = new SessionManager({ store: new InMemorySessionStore(), now: () => now, ttlMs: 1000 });
  await sessions.createAccount({ userId: 'u1', username: 'user', password: 'secret123', organizationId: 'org1', roles: [role] });
  const login = await sessions.login('user', 'secret123');
  now = new Date('2026-01-01T00:00:02Z');
  await expect(sessions.authenticate(login.token)).rejects.toThrow('401');
});

it('формирует cookie и аудит без секретов и скрытого содержания', () => {
  expect(sessionCookie('abc', 60)).toBe('kshvi_session=abc; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Strict');
  const record = auditRecord({ actorId: 'u1', action: 'document.read', correlationId: 'c1', resourceId: 'd1', password: 'secret123', token: 'raw', content: 'замысел' });
  expect(record).toEqual({ actorId: 'u1', action: 'document.read', correlationId: 'c1', resourceId: 'd1' });
});


const databaseIntegration = process.env.TEST_DATABASE_URL ? it : it.skip;
databaseIntegration('сохраняет только хеши сессии в PostgreSQL и восстанавливает отзыв', async () => {
  const { withKshviDatabase } = await import('./helpers/database');
  const { PgSessionStore } = await import('../src/auth/pg-session-store');
  await withKshviDatabase(async eventStore => {
    const store = new PgSessionStore(eventStore.pool, eventStore.schema);
    await store.init();
    const sessions = new SessionManager({ store });
    await sessions.createAccount({ userId: 'u1', username: 'persistent', password: 'secret123', organizationId: 'org1', roles: [role] });
    const login = await sessions.login('persistent', 'secret123');
    const raw = await eventStore.pool.query(`select token_hash, csrf_hash from ${eventStore.schema}.sessions`);
    expect(JSON.stringify(raw.rows)).not.toContain(login.token);
    expect(JSON.stringify(raw.rows)).not.toContain(login.csrfToken);
    await sessions.revoke(login.token);
    const another = new SessionManager({ store });
    await expect(another.authenticate(login.token)).rejects.toThrow('401');
  });
});
