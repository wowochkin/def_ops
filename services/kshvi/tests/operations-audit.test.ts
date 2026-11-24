import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { BackupService, type BackupSource } from '../src/admin/backup-service';
import { RestoreService } from '../src/admin/restore-service';
import { runSafeUpdate, type UpdatePorts } from '../src/admin/update-service';
import { SecurityAudit } from '../src/auth/security-audit';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const updatePorts: UpdatePorts = {
  pauseSession: async () => {}, createSnapshot: async () => ({ snapshotId: 's1' }), verifySnapshot: async () => true,
  createFullBackup: async () => ({ backupId: 'b1' }), testMigrationOnCopy: async () => {}, checkCompatibility: async () => {},
  appendJournal: async () => 'update-event', applyMigration: async () => {},
  runPostChecks: async () => ({ archives: true, projections: true, environment: true, documents: true, controlCalculation: true }),
  rollback: async () => {}, resumeSession: async () => {},
};

it('фиксирует копирование, проверку, восстановление и обновление в аудите', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-operations-audit-'));
  roots.push(root);
  const values = { 'scenario.json': 'scenario', 'environment.json': 'environment', 'assignments.json': 'assignments', 'journal.jsonl': 'journal', 'snapshot.json': 'snapshot' };
  await Promise.all(Object.entries(values).map(([name, value]) => writeFile(join(root, name), value)));
  const sources: BackupSource[] = [
    { name: 'scenario.json', path: join(root, 'scenario.json'), category: 'SCENARIO' },
    { name: 'environment.json', path: join(root, 'environment.json'), category: 'ENVIRONMENT' },
    { name: 'assignments.json', path: join(root, 'assignments.json'), category: 'ASSIGNMENTS' },
    { name: 'journal.jsonl', path: join(root, 'journal.jsonl'), category: 'JOURNAL' },
    { name: 'snapshot.json', path: join(root, 'snapshot.json'), category: 'SNAPSHOT' },
  ];
  const audit = new SecurityAudit();
  const auditContext = { actorId: 'admin-org-1', organizationId: 'org-1' };
  const backups = new BackupService({ rootDirectory: join(root, 'backups'), audit });
  const full = await backups.createFullBackup({ instanceId: 'i1', sources, lastSequence: 1, versions: { schema: '1.0.0', reducer: 1 }, auditContext });
  await backups.verifyBackup(full.id, auditContext);
  const restore = new RestoreService({ backups, isolationRoot: join(root, 'isolated'), audit });
  await restore.restoreToIsolated({ backupId: full.id, activeLastSequence: 1, isolationId: 'audit', auditContext });
  await runSafeUpdate(
    { session: { active: false, mode: 'OFFICIAL', emergency: false }, migration: { version: '2.0.0', rollbackApplicationVersion: '1.0.0', incompatible: false, rewritesHistoricalPayload: false, migrationProtocolId: null, sourceArchiveId: null }, auditContext },
    updatePorts,
    audit,
  );
  const exported = audit.export({ userId: 'auditor-org-1', organizationId: 'org-1', technicalPermissions: ['audit.export'] }, 'operations-export');
  expect(exported.map(event => event.action)).toEqual(expect.arrayContaining([
    'backup.full_created', 'backup.verified', 'restore.completed', 'update.completed',
  ]));
  for (const action of ['backup.full_created', 'backup.verified', 'restore.completed', 'update.completed']) {
    expect(exported.find(event => event.action === action)).toMatchObject({ actorId: 'admin-org-1', organizationId: 'org-1' });
  }
  expect(JSON.stringify(exported)).not.toContain('"organizationId":"local"');
});
