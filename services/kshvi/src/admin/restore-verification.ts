import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupManifest } from './backup-service';

export async function verifyRestoredFiles(manifest: BackupManifest, restoredDirectory: string): Promise<{
  valid: boolean;
  checkedFiles: number;
  issues: string[];
}> {
  const issues: string[] = [];
  let checkedFiles = 0;
  for (const file of manifest.files) {
    try {
      const content = await readFile(join(restoredDirectory, file.name));
      const actual = createHash('sha256').update(content).digest('hex');
      if (actual !== file.assembledSha256 || content.byteLength !== file.assembledSize) issues.push(`HASH_MISMATCH:${file.name}`);
      checkedFiles += 1;
    } catch {
      issues.push(`FILE_MISSING:${file.name}`);
    }
  }
  return { valid: issues.length === 0 && checkedFiles === manifest.files.length, checkedFiles, issues };
}

export function assertRecoveryObjectives(input: {
  confirmedEventsLost: number;
  restartMs: number;
  nodeRestoreMs: number;
}): { passed: true; rpo: 0; restartWithinTarget: true; nodeRestoreWithinTarget: true } {
  if (!Number.isFinite(input.confirmedEventsLost) || input.confirmedEventsLost !== 0) throw new Error('Нарушен RPO подтверждённых событий');
  if (!Number.isFinite(input.restartMs) || !Number.isFinite(input.nodeRestoreMs)) throw new Error('Временные цели должны быть конечным числом');
  if (input.restartMs < 0 || input.restartMs > 300_000) throw new Error('Перезапуск превысил 5 мин');
  if (input.nodeRestoreMs < 0 || input.nodeRestoreMs > 1_800_000) throw new Error('Восстановление узла превысило 30 мин');
  return { passed: true, rpo: 0, restartWithinTarget: true, nodeRestoreWithinTarget: true };
}
