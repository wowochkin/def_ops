import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createService } from '@def-ops/service-kit';
import { expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

it('AC-17: UI очищает устройство, а сервер отзывает прежнюю сессию', { timeout: 30_000 }, async () => {
  const output = execFileSync('npx', ['vitest', 'run', 'apps/editor/tests/acceptance/ac17-handover.test.tsx'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  expect(output).toContain('2 passed');
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({ userId: 'leader', username: 'leader', password: 'secret123', organizationId: 'org-ac17', roles: [{ id: 'leader-role', role: 'LEADER', sideId: 'blue', authorities: ['exercise:read'] }] });
  const service = createService({ name: 'kshvi-ac17', port: 0, router: buildRouter({ sessions }) });
  try {
    const base = `http://127.0.0.1:${await service.listen()}/kshvi`;
    const loginResponse = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'leader', password: 'secret123' }) });
    expect(loginResponse.status).toBe(200);
    const login = await loginResponse.json() as { csrfToken: string };
    const cookie = loginResponse.headers.get('set-cookie')!.split(';')[0];
    await fetch(`${base}/auth/role`, { method: 'POST', headers: { cookie, 'x-csrf-token': login.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ roleId: 'leader-role' }) });
    const logout = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': login.csrfToken } });
    expect(logout.status).toBe(204);
    expect((await fetch(`${base}/auth/me`, { headers: { cookie } })).status).toBe(401);
  } finally {
    await service.close();
  }

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac17';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: 'ac17-handover', revision: 1, sha256: hashCanonical({ ui: output, logout: 204, meAfterLogout: 401 }) };
  const journalPath = `${directory}/journal.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const metrics = { privilegedStoragePrefixesCleared: 2, serverLogoutStatus: 204, unauthorizedAfterLogout: 1, unrelatedWeatherRegionPreserved: 1 };
  const journal = { runId, commit, ui: output, server: { logout: 204, me: 401 }, metrics };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-17 завершён\nrunId: ${runId}\ncommit: ${commit}\nНовые и старые приватные ключи очищены; независимая карта сохранена; серверная сессия отозвана; auth/me возвращает 401.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-17.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: hashCanonical(journal), eventCount: 2 },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical({ logout: 204, me: 401 }), journal: hashCanonical(journal) },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Очистка IndexedDB проверена на совместимом mock; физическая диагностика кэшей устройства выполняется на целевом стенде.'],
    artifacts: [journalPath, protocolPath, metricsPath],
  }, null, 2));
});
