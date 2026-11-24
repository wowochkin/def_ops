import { readFile } from 'node:fs/promises';
import { BackupService } from '../services/kshvi/src/admin/backup-service.ts';
import { RestoreService } from '../services/kshvi/src/admin/restore-service.ts';

const options = {};
for (let index = 0; index < process.argv.length - 2; index += 2) {
  const key = process.argv[index + 2];
  if (!key?.startsWith('--')) throw new Error(`Неизвестный параметр ${key}`);
  options[key.slice(2)] = process.argv[index + 3];
}
for (const required of ['root', 'backup-id', 'isolation-root', 'isolation-id', 'active-sequence']) {
  if (!options[required]) throw new Error(`Требуется параметр --${required}`);
}
const backups = new BackupService({ rootDirectory: options.root });
const restore = new RestoreService({ backups, isolationRoot: options['isolation-root'] });
const result = await restore.restoreToIsolated({
  backupId: options['backup-id'],
  activeLastSequence: Number(options['active-sequence']),
  isolationId: options['isolation-id'],
  ...(options['active-journal'] ? { activeJournal: JSON.parse(await readFile(options['active-journal'], 'utf8')) } : {}),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
