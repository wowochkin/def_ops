import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export type BackupCategory = 'SCENARIO' | 'ENVIRONMENT' | 'ASSIGNMENTS' | 'JOURNAL' | 'SNAPSHOT';
export type BackupSource = Readonly<{ name: string; path: string; category: BackupCategory }>;
export type BackupFile = Readonly<{
  name: string;
  category: BackupCategory;
  sha256: string;
  size: number;
  offset: number;
  assembledSha256: string;
  assembledSize: number;
}>;
export type BackupManifest = Readonly<{
  schemaVersion: 1;
  id: string;
  instanceId: string;
  kind: 'FULL' | 'INCREMENTAL';
  baseBackupId: string | null;
  createdAt: string;
  lastSequence: number;
  versions: { schema: string; reducer: number };
  files: readonly BackupFile[];
}>;
export type BackupVerification = Readonly<{
  valid: boolean;
  checkedFiles: number;
  issues: readonly { code: 'HASH_MISMATCH' | 'FILE_MISSING'; name: string }[];
}>;

function safeName(name: string): void {
  if (!name || basename(name) !== name || name === 'manifest.json') throw new Error('Недопустимое имя файла резервной копии');
}
function safeId(id: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Недопустимый идентификатор резервной копии');
}
function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export class BackupService {
  private readonly rootDirectory: string;
  private readonly now: () => Date;

  constructor(options: { rootDirectory: string; now?: () => Date }) {
    this.rootDirectory = resolve(options.rootDirectory);
    this.now = options.now ?? (() => new Date());
  }

  async createFullBackup(input: {
    instanceId: string;
    sources: readonly BackupSource[];
    lastSequence: number;
    versions: { schema: string; reducer: number };
  }): Promise<BackupManifest> {
    const required: BackupCategory[] = ['SCENARIO', 'ENVIRONMENT', 'ASSIGNMENTS', 'JOURNAL', 'SNAPSHOT'];
    const missing = required.filter(category => !input.sources.some(source => source.category === category));
    if (missing.length) throw new Error(`Полная копия не содержит: ${missing.join(', ')}`);
    return this.create({ ...input, kind: 'FULL', baseBackupId: null });
  }

  async createIncrementalBackup(input: {
    instanceId: string;
    baseBackupId: string;
    sources: readonly BackupSource[];
    lastSequence: number;
    versions: { schema: string; reducer: number };
  }): Promise<BackupManifest> {
    const base = await this.readManifest(input.baseBackupId);
    if (base.instanceId !== input.instanceId) throw new Error('Базовая копия принадлежит другому сеансу');
    if (!input.sources.length || input.sources.some(source => !['JOURNAL', 'SNAPSHOT'].includes(source.category))) {
      throw new Error('Инкремент содержит только журнал и снимки');
    }
    if (input.lastSequence < base.lastSequence) throw new Error('Инкремент не может откатывать последовательность журнала');
    return this.create({ ...input, kind: 'INCREMENTAL' }, base);
  }

  async readManifest(backupId: string): Promise<BackupManifest> {
    safeId(backupId);
    return JSON.parse(await readFile(join(this.rootDirectory, backupId, 'manifest.json'), 'utf8')) as BackupManifest;
  }

  directoryFor(backupId: string): string {
    safeId(backupId);
    return join(this.rootDirectory, backupId);
  }

  async verifyBackup(backupId: string): Promise<BackupVerification> {
    const manifest = await this.readManifest(backupId);
    const issues: { code: 'HASH_MISMATCH' | 'FILE_MISSING'; name: string }[] = [];
    let checkedFiles = 0;
    for (const file of manifest.files) {
      try {
        const content = await readFile(join(this.directoryFor(backupId), 'files', file.name));
        if (sha256(content) !== file.sha256 || content.byteLength !== file.size) issues.push({ code: 'HASH_MISMATCH', name: file.name });
        checkedFiles += 1;
      } catch {
        issues.push({ code: 'FILE_MISSING', name: file.name });
      }
    }
    return { valid: issues.length === 0 && checkedFiles === manifest.files.length, checkedFiles, issues };
  }

  private async create(input: {
    instanceId: string;
    sources: readonly BackupSource[];
    lastSequence: number;
    versions: { schema: string; reducer: number };
    kind: 'FULL' | 'INCREMENTAL';
    baseBackupId: string | null;
  }, base?: BackupManifest): Promise<BackupManifest> {
    if (!Number.isSafeInteger(input.lastSequence) || input.lastSequence < 0) throw new Error('Последовательность копии некорректна');
    const names = new Set<string>();
    for (const source of input.sources) {
      safeName(source.name);
      if (names.has(source.name)) throw new Error('Дубликат файла в резервной копии');
      names.add(source.name);
    }
    const id = randomUUID();
    const filesDirectory = join(this.rootDirectory, id, 'files');
    await mkdir(filesDirectory, { recursive: true });
    const files: BackupFile[] = [];
    for (const source of input.sources) {
      const assembled = await readFile(source.path);
      let offset = 0;
      let fragment = assembled;
      if (input.kind === 'INCREMENTAL' && source.category === 'JOURNAL') {
        const baseFile = base?.files.find(file => file.name === source.name && file.category === source.category);
        if (baseFile) {
          offset = baseFile.assembledSize;
          if (assembled.byteLength < offset) throw new Error('Активный журнал короче базовой копии');
          if (sha256(assembled.subarray(0, offset)) !== baseFile.assembledSha256) throw new Error('Базовая часть журнала изменилась');
          fragment = assembled.subarray(offset);
          if (!fragment.byteLength) throw new Error('Инкремент журнала пуст');
        }
      }
      await writeFile(join(filesDirectory, source.name), fragment, { flag: 'wx' });
      files.push({
        name: source.name, category: source.category, sha256: sha256(fragment), size: fragment.byteLength,
        offset, assembledSha256: sha256(assembled), assembledSize: assembled.byteLength,
      });
    }
    const manifest: BackupManifest = Object.freeze({
      schemaVersion: 1, id, instanceId: input.instanceId, kind: input.kind, baseBackupId: input.baseBackupId,
      createdAt: this.now().toISOString(), lastSequence: input.lastSequence, versions: { ...input.versions }, files,
    });
    await writeFile(join(this.rootDirectory, id, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return structuredClone(manifest);
  }
}

export function assertBackupCadence(input: {
  preStartFullBackupId: string | null;
  lastIncrementalAt: string | null;
  now: string;
  checkpoint: 'NONE' | 'BEFORE_JUMP' | 'BEFORE_FINISH';
  checkpointBackupId?: string;
}): void {
  if (!input.preStartFullBackupId) throw new Error('Обязательная предстартовая полная копия отсутствует');
  if (!input.lastIncrementalAt) throw new Error('Инкрементальная копия журнала отсутствует');
  const elapsed = Date.parse(input.now) - Date.parse(input.lastIncrementalAt);
  if (elapsed < 0 || elapsed > 5 * 60 * 1000) throw new Error('Инкремент журнала должен копироваться не реже чем каждые 5 мин');
  if (input.checkpoint !== 'NONE' && !input.checkpointBackupId) throw new Error('Перед скачком или завершением нужна контрольная копия');
}
