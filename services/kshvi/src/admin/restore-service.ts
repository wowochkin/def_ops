import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditSink, OperationAuditContext } from '../auth/durable-jsonl';
import type { BackupFile, BackupManifest, BackupService, JournalEventIdentity } from './backup-service';
import type { DivergenceDifference, DivergenceReport } from './divergence-report';
import { createDivergenceReport } from './divergence-report';
import { assertDirectoryIfExists, assertPathInside } from './path-safety';
import { verifyRestoredFiles } from './restore-verification';

export type RestorePlan = { allowed: true } | {
  allowed: false;
  requiredReport: 'DIVERGENCE';
  preservedSequence: number;
  divergenceReport: DivergenceReport;
};
export type RestoreResult = {
  allowed: false;
  requiredReport: 'DIVERGENCE';
  preservedSequence: number;
  divergenceReport: DivergenceReport;
} | {
  allowed: true;
  restoredDirectory: string;
  verifiedHashes: number;
  lastSequence: number;
};

function denied(input: { backupLastSequence: number; activeLastSequence: number; laterEvents: readonly JournalEventIdentity[]; differences: readonly DivergenceDifference[] }): RestorePlan {
  return {
    allowed: false,
    requiredReport: 'DIVERGENCE',
    preservedSequence: input.activeLastSequence,
    divergenceReport: createDivergenceReport(input),
  };
}

export function planRestore(input: {
  backupLastSequence: number;
  activeLastSequence: number;
  backupJournal?: readonly JournalEventIdentity[];
  activeJournal?: readonly JournalEventIdentity[];
}): RestorePlan {
  if (input.backupJournal !== undefined || input.activeJournal !== undefined) {
    if (!input.backupJournal || !input.activeJournal) throw new Error('Для сравнения нужны идентичности обоих журналов');
    const differences: DivergenceDifference[] = [];
    const backupBySequence = new Map(input.backupJournal.map(event => [event.sequence, event]));
    for (const active of input.activeJournal) {
      const backup = backupBySequence.get(active.sequence);
      if (!backup) {
        differences.push({ code: 'EVENT_MISSING', sequence: active.sequence, activeEventId: active.eventId, activeHash: active.hash, activeBranchId: active.branchId });
        continue;
      }
      if (backup.eventId !== active.eventId) differences.push({ code: 'EVENT_ID_MISMATCH', sequence: active.sequence, backupEventId: backup.eventId, activeEventId: active.eventId });
      if (backup.hash !== active.hash) differences.push({ code: 'HASH_MISMATCH', sequence: active.sequence, backupHash: backup.hash, activeHash: active.hash });
      if (backup.branchId !== active.branchId) differences.push({ code: 'BRANCH_MISMATCH', sequence: active.sequence, backupBranchId: backup.branchId, activeBranchId: active.branchId });
    }
    if (input.backupLastSequence < input.activeLastSequence) differences.push({ code: 'ACTIVE_SEQUENCE_AHEAD', sequence: input.activeLastSequence });
    if (differences.length) {
      const laterEvents = input.activeJournal.filter(event => event.sequence > input.backupLastSequence);
      return denied({ ...input, laterEvents, differences });
    }
    return { allowed: true };
  }
  if (input.backupLastSequence < input.activeLastSequence) {
    return denied({ ...input, laterEvents: [], differences: [{ code: 'ACTIVE_SEQUENCE_AHEAD', sequence: input.activeLastSequence }] });
  }
  return { allowed: true };
}

export class RestoreService {
  private readonly backups: BackupService;
  private readonly isolationRoot: string;
  private readonly audit?: AuditSink;

  constructor(options: { backups: BackupService; isolationRoot: string; audit?: AuditSink }) {
    this.backups = options.backups;
    this.isolationRoot = resolve(options.isolationRoot);
    this.audit = options.audit;
  }

  async restoreToIsolated(input: {
    backupId: string;
    activeLastSequence: number;
    isolationId: string;
    activeJournal?: readonly JournalEventIdentity[];
    auditContext?: OperationAuditContext;
  }): Promise<RestoreResult> {
    if (this.audit && !input.auditContext) throw new Error('Для аудита восстановления требуется actor/org операции');
    if (!/^[a-zA-Z0-9-]+$/.test(input.isolationId)) throw new Error('Недопустимый идентификатор изолированного восстановления');
    await assertDirectoryIfExists(this.isolationRoot, 'Изолированный корень восстановления');
    const manifest = await this.backups.readManifest(input.backupId);
    if (input.activeJournal && !manifest.journalEvents) throw new Error('В манифесте отсутствуют идентичности журнала для сравнения');
    const plan = planRestore({
      backupLastSequence: manifest.lastSequence,
      activeLastSequence: input.activeLastSequence,
      ...(input.activeJournal ? { backupJournal: manifest.journalEvents, activeJournal: input.activeJournal } : {}),
    });
    if (!plan.allowed) {
      this.record('restore.divergence', input.backupId, 'DENIED', input.auditContext);
      return plan;
    }
    const chain = await this.verifiedChain(manifest, input.auditContext);
    this.assertJournalCoverage(manifest, chain);
    const restoredDirectory = join(this.isolationRoot, input.isolationId);
    assertPathInside(this.isolationRoot, restoredDirectory, 'Изолированное назначение восстановления');
    await mkdir(this.isolationRoot, { recursive: true });
    await mkdir(restoredDirectory, { recursive: false });
    const assembledFiles = new Map<string, BackupFile>();
    for (const backup of chain) {
      for (const file of backup.files) {
        const fragment = await this.backups.readBackupFile(backup.id, file.name);
        const destination = join(restoredDirectory, file.name);
        assertPathInside(restoredDirectory, destination, 'Файл изолированного восстановления');
        if (file.offset === 0) await writeFile(destination, fragment);
        else await appendFile(destination, fragment);
        assembledFiles.set(file.name, file);
      }
    }
    const verification = await verifyRestoredFiles({ ...manifest, files: [...assembledFiles.values()] }, restoredDirectory);
    if (!verification.valid) throw new Error('Хеши изолированного восстановления не совпадают');
    this.record('restore.completed', input.backupId, 'ALLOWED', input.auditContext);
    return { allowed: true, restoredDirectory, verifiedHashes: verification.checkedFiles, lastSequence: manifest.lastSequence };
  }

  private async verifiedChain(manifest: BackupManifest, auditContext?: OperationAuditContext): Promise<BackupManifest[]> {
    const chain: BackupManifest[] = [];
    const visited = new Set<string>();
    let current: BackupManifest | undefined = manifest;
    while (current) {
      if (visited.has(current.id)) throw new Error('Циклическая ссылка в цепочке резервных копий');
      visited.add(current.id);
      const verification = await this.backups.verifyBackup(current.id, auditContext);
      if (!verification.valid) throw new Error('Резервная копия повреждена и не может быть восстановлена');
      chain.unshift(current);
      current = current.baseBackupId ? await this.backups.readManifest(current.baseBackupId) : undefined;
    }
    if (chain[0]?.kind !== 'FULL') throw new Error('Цепочка восстановления не начинается с полной копии');
    return chain;
  }

  private assertJournalCoverage(manifest: BackupManifest, chain: readonly BackupManifest[]): void {
    const coveredSequence = chain.reduce((latest, backup) => backup.files.some(file => file.category === 'JOURNAL')
      ? Math.max(latest, backup.lastSequence) : latest, 0);
    if (coveredSequence < manifest.lastSequence) {
      throw new Error(`Журнальная цепочка покрывает только ${coveredSequence} из ${manifest.lastSequence}`);
    }
    if (manifest.journalEvents) {
      const identities = chain.flatMap(backup => backup.journalEvents ?? []);
      for (const expected of manifest.journalEvents) {
        const found = identities.some(event => event.sequence === expected.sequence && event.eventId === expected.eventId
          && event.hash === expected.hash && event.branchId === expected.branchId);
        if (!found) throw new Error(`В цепочке отсутствует событие ${expected.eventId} на последовательности ${expected.sequence}`);
      }
    }
  }

  private record(action: string, resourceId: string, outcome: 'ALLOWED' | 'DENIED', auditContext?: OperationAuditContext): void {
    if (!this.audit) return;
    if (!auditContext) throw new Error('Для аудита восстановления требуется actor/org операции');
    this.audit.append({ actorId: auditContext.actorId, organizationId: auditContext.organizationId, action, outcome, correlationId: randomUUID(), resourceType: 'backup', resourceId });
  }
}
