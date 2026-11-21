import { appendFile, copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BackupFile, BackupManifest, BackupService } from './backup-service';
import { verifyRestoredFiles } from './restore-verification';

export type RestorePlan = { allowed: true } | {
  allowed: false;
  requiredReport: 'DIVERGENCE';
  preservedSequence: number;
};
export type RestoreResult = {
  allowed: false;
  requiredReport: 'DIVERGENCE';
  preservedSequence: number;
} | {
  allowed: true;
  restoredDirectory: string;
  verifiedHashes: number;
  lastSequence: number;
};

export function planRestore(input: { backupLastSequence: number; activeLastSequence: number }): RestorePlan {
  if (input.backupLastSequence < input.activeLastSequence) {
    return { allowed: false, requiredReport: 'DIVERGENCE', preservedSequence: input.activeLastSequence };
  }
  return { allowed: true };
}

export class RestoreService {
  private readonly backups: BackupService;
  private readonly isolationRoot: string;

  constructor(options: { backups: BackupService; isolationRoot: string }) {
    this.backups = options.backups;
    this.isolationRoot = resolve(options.isolationRoot);
  }

  async restoreToIsolated(input: { backupId: string; activeLastSequence: number; isolationId: string }): Promise<RestoreResult> {
    if (!/^[a-zA-Z0-9-]+$/.test(input.isolationId)) throw new Error('Недопустимый идентификатор изолированного восстановления');
    const manifest = await this.backups.readManifest(input.backupId);
    const plan = planRestore({ backupLastSequence: manifest.lastSequence, activeLastSequence: input.activeLastSequence });
    if (!plan.allowed) return plan;
    const chain = await this.verifiedChain(manifest);
    const restoredDirectory = join(this.isolationRoot, input.isolationId);
    await mkdir(this.isolationRoot, { recursive: true });
    await mkdir(restoredDirectory, { recursive: false });
    const assembledFiles = new Map<string, BackupFile>();
    for (const backup of chain) {
      for (const file of backup.files) {
        const fragment = join(this.backups.directoryFor(backup.id), 'files', file.name);
        const destination = join(restoredDirectory, file.name);
        if (file.offset === 0) await copyFile(fragment, destination);
        else await appendFile(destination, await readFile(fragment));
        assembledFiles.set(file.name, file);
      }
    }
    const verification = await verifyRestoredFiles({ ...manifest, files: [...assembledFiles.values()] }, restoredDirectory);
    if (!verification.valid) throw new Error('Хеши изолированного восстановления не совпадают');
    return { allowed: true, restoredDirectory, verifiedHashes: verification.checkedFiles, lastSequence: manifest.lastSequence };
  }

  private async verifiedChain(manifest: BackupManifest): Promise<BackupManifest[]> {
    const chain: BackupManifest[] = [];
    const visited = new Set<string>();
    let current: BackupManifest | undefined = manifest;
    while (current) {
      if (visited.has(current.id)) throw new Error('Циклическая ссылка в цепочке резервных копий');
      visited.add(current.id);
      const verification = await this.backups.verifyBackup(current.id);
      if (!verification.valid) throw new Error('Резервная копия повреждена и не может быть восстановлена');
      chain.unshift(current);
      current = current.baseBackupId ? await this.backups.readManifest(current.baseBackupId) : undefined;
    }
    if (chain[0]?.kind !== 'FULL') throw new Error('Цепочка восстановления не начинается с полной копии');
    return chain;
  }
}
