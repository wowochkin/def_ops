import { basename } from 'node:path';
import { BackupService } from '../services/kshvi/src/admin/backup-service.ts';

function args(argv) {
  const result = { source: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--source') result.source.push(argv[++index]);
    else if (key?.startsWith('--')) result[key.slice(2)] = argv[++index];
  }
  return result;
}

const options = args(process.argv.slice(2));
for (const required of ['root', 'instance', 'last-sequence']) {
  if (!options[required]) throw new Error(`Требуется параметр --${required}`);
}
if (!options.source.length) throw new Error('Требуется хотя бы один --source CATEGORY=PATH');
const sources = options.source.map(value => {
  const separator = value.indexOf('=');
  if (separator < 1) throw new Error('Источник должен иметь вид CATEGORY=PATH');
  const category = value.slice(0, separator);
  const path = value.slice(separator + 1);
  return { category, path, name: basename(path) };
});
const backups = new BackupService({ rootDirectory: options.root });
const input = {
  instanceId: options.instance,
  sources,
  lastSequence: Number(options['last-sequence']),
  versions: { schema: options.schema ?? '1.0.0', reducer: Number(options.reducer ?? 1) },
};
if (options['journal-events']) input.journalEvents = JSON.parse(await (await import('node:fs/promises')).readFile(options['journal-events'], 'utf8'));
const manifest = options.base
  ? await backups.createIncrementalBackup({ ...input, baseBackupId: options.base })
  : await backups.createFullBackup(input);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
