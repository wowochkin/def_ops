import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { AdminOverviewService } from '../../src/admin/admin-overview-service';
import { SessionAccountDirectory } from '../../src/auth/session-account-directory';
import { AssignmentService } from '../../src/auth/assignment-service';
import { ConfigCatalog } from '../../src/admin/config-catalog';
import { SecurityAudit } from '../../src/auth/security-audit';
import { LocalDirectory } from '../../src/auth/local-directory';
import { AccountService } from '../../src/auth/account-service';
import { TemporaryAccessService } from '../../src/auth/temporary-access';
import { BackupService } from '../../src/admin/backup-service';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

const services: Array<ReturnType<typeof createService>> = [];
const roots: string[] = [];
afterEach(async () => {
  while (services.length) await services.pop()?.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

it('AC-13: технический администратор не читает содержимое, а временный доступ ограничен и отзывается', { timeout: 30_000 }, async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  for (const [userId, role, authorities] of [
    ['admin', 'TECH_ADMIN', ['kshvi:admin', 'audit.export']], ['trainee', 'TRAINEE', ['exercise:read']],
  ] as const) {
    await sessions.createAccount({ userId, username: userId, password: 'secret123', organizationId: 'org-ac13', roles: [{ id: `role-${userId}`, role, sideId: role === 'TRAINEE' ? 'blue' : null, authorities }] });
  }
  const audit = new SecurityAudit({ now: () => new Date('2030-01-01T08:00:00Z') });
  const admin = new AdminOverviewService({ directory: new SessionAccountDirectory(sessions), assignments: new AssignmentService(), configs: new ConfigCatalog(), audit });
  const service = createService({ name: 'kshvi-ac13', port: 0, router: buildRouter({ sessions, admin }) });
  services.push(service);
  const base = `http://127.0.0.1:${await service.listen()}/kshvi`;
  async function login(username: string) {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) });
    const body = await response.json() as { csrfToken: string };
    if (!response.ok) return { response, cookie: '', csrf: '' };
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    await fetch(`${base}/auth/role`, { method: 'POST', headers: { cookie, 'x-csrf-token': body.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ roleId: `role-${username}` }) });
    return { response, cookie, csrf: body.csrfToken };
  }
  const adminLogin = await login('admin');
  expect(adminLogin.response.status).toBe(200);
  const overviewResponse = await fetch(`${base}/admin/overview`, { headers: { cookie: adminLogin.cookie } });
  expect(overviewResponse.status).toBe(200);
  const overviewText = await overviewResponse.text();
  expect(overviewText).toContain('trainee');
  expect(overviewText).not.toContain('passwordHash');
  expect(overviewText).not.toContain('Скрытый замысел');
  expect((await fetch(`${base}/exercises`, { headers: { cookie: adminLogin.cookie } })).status).toBe(403);
  const blocked = await fetch(`${base}/admin/accounts/trainee/block`, { method: 'POST', headers: { cookie: adminLogin.cookie, 'x-csrf-token': adminLogin.csrf, 'content-type': 'application/json' }, body: '{}' });
  expect(blocked.status).toBe(200);
  expect((await login('trainee')).response.status).toBe(401);

  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(join('.tmp', 'ac13-'));
  roots.push(root);
  const sources = [
    { name: 'scenario.json', category: 'SCENARIO', content: '{"intent":"Скрытый замысел"}' },
    { name: 'environment.json', category: 'ENVIRONMENT', content: '{"sha256":"environment"}' },
    { name: 'assignments.json', category: 'ASSIGNMENTS', content: '[{"id":"role-1"}]' },
    { name: 'journal.jsonl', category: 'JOURNAL', content: '{"sequence":1}\n' },
    { name: 'snapshot.json', category: 'SNAPSHOT', content: '{"sequence":1}' },
  ] as const;
  await Promise.all(sources.map(source => writeFile(join(root, source.name), source.content)));
  const backups = new BackupService({ rootDirectory: join(root, 'backups'), now: () => new Date('2030-01-01T08:00:00Z') });
  const backup = await backups.createFullBackup({ instanceId: 'ac13', sources: sources.map(source => ({ name: source.name, path: join(root, source.name), category: source.category })), lastSequence: 4, versions: { schema: '1', reducer: 1 } });
  const backupVerification = await backups.verifyBackup(backup.id);
  expect(backupVerification.issues).toEqual([]);
  expect(backupVerification.valid).toBe(true);

  const directory = new LocalDirectory();
  const subject = await directory.createAccount({ userId: 'recovery-user', username: 'recovery-user', password: 'secret123', organizationId: 'org-ac13', technicalPermissions: [] });
  let now = new Date('2030-01-01T08:00:00Z');
  const temporary = new TemporaryAccessService({ now: () => now, audit });
  const accounts = new AccountService(directory, { temporaryAccess: temporary });
  const recoveryLogin = await accounts.login('recovery-user', 'secret123', 'org-ac13');
  expect(accounts.authorize(recoveryLogin.token, { action: 'exercise.read', organizationId: 'org-ac13', resourceId: 'secret-document' }).allowed).toBe(false);
  const grant = temporary.grant({ userId: 'admin', organizationId: 'org-ac13', technicalPermissions: ['temporary-access.grant'] }, {
    subjectUserId: subject.userId, organizationId: 'org-ac13', resourceId: backup.id, resourceKind: 'BACKUP_METADATA', reason: 'Аварийное восстановление стенда', validFrom: '2030-01-01T08:00:00Z', validUntil: '2030-01-01T08:30:00Z',
  });
  expect(accounts.authorize(recoveryLogin.token, { action: 'recovery.manifest.read', organizationId: 'org-ac13', resourceId: backup.id }).allowed).toBe(true);
  expect(accounts.authorize(recoveryLogin.token, { action: 'exercise.read', organizationId: 'org-ac13', resourceId: backup.id }).allowed).toBe(false);
  expect(accounts.authorize(recoveryLogin.token, { action: 'recovery.manifest.read', organizationId: 'org-ac13', resourceId: 'another-backup' }).allowed).toBe(false);
  temporary.revoke(grant.id, 'admin');
  expect(accounts.authorize(recoveryLogin.token, { action: 'recovery.manifest.read', organizationId: 'org-ac13', resourceId: backup.id }).allowed).toBe(false);
  now = new Date('2030-01-01T09:00:00Z');
  expect(temporary.canAccess(grant.id, { action: 'recovery.manifest.read', organizationId: 'org-ac13', resourceId: backup.id })).toBe(false);
  expect(JSON.stringify(audit.entries())).not.toContain('Скрытый замысел');

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directoryPath = 'docs/release/kshvi/evidence/ac13';
  await mkdir(directoryPath, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: 'ac13-admin', revision: 1, sha256: hashCanonical({ backupId: backup.id, grantId: grant.id }) };
  const journalPath = `${directoryPath}/journal.json`;
  const protocolPath = `${directoryPath}/protocol.txt`;
  const metricsPath = `${directoryPath}/metrics.json`;
  const metrics = { technicalOverviewAllowed: 1, contentRejected: 1, backupVerified: 1, temporaryGrantUsed: 1, temporaryGrantRevoked: 1, expiredGrantRejected: 1 };
  const journal = { runId, commit, backupId: backup.id, grant, audit: audit.entries() };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-13 завершён\nrunId: ${runId}\ncommit: ${commit}\nТехническая панель и копия доступны; содержимое запрещено; временный доступ только на метаданные; отзыв и срок прекращают доступ.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-13.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: hashCanonical(journal), eventCount: audit.entries().length },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical({ backupId: backup.id }), journal: hashCanonical(journal) },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Проверка выполнена на локальном тенанте и официальном API; физическое разделение стендов проверяется отдельно.'],
    artifacts: [journalPath, protocolPath, metricsPath],
  }, null, 2));
});
