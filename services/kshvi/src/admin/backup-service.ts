import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { AuditSink, OperationAuditContext } from '../auth/durable-jsonl';
import { assertDirectoryIfExists, assertPathInside, assertRegularFile } from './path-safety';

export type BackupCategory = 'SCENARIO' | 'ENVIRONMENT' | 'ASSIGNMENTS' | 'JOURNAL' | 'SNAPSHOT';
export type BackupSource = Readonly<{ name: string; path: string; category: BackupCategory }>;
export type JournalEventIdentity = Readonly<{ sequence: number; eventId: string; hash: string; branchId: string }>;
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
  journalEvents?: readonly JournalEventIdentity[];
}>;
export type BackupVerification = Readonly<{
  valid: boolean;
  checkedFiles: number;
  issues: readonly { code: 'HASH_MISMATCH' | 'FILE_MISSING'; name: string }[];
}>;

const categories = new Set<BackupCategory>(['SCENARIO', 'ENVIRONMENT', 'ASSIGNMENTS', 'JOURNAL', 'SNAPSHOT']);
const hashPattern = /^[a-f0-9]{64}$/;
function safeName(name: string): void {
  if (!name || basename(name) !== name || name === 'manifest.json' || !/^[a-zA-Z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error('Недопустимое имя файла резервной копии');
  }
}
function safeId(id: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Недопустимый идентификатор резервной копии');
}
function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validateBackupManifest(value: unknown, expectedId?: string): BackupManifest {
  if (!value || typeof value !== 'object') throw new Error('Неверная схема манифеста резервной копии');
  const manifest = value as BackupManifest;
  if (manifest.schemaVersion !== 1 || typeof manifest.id !== 'string' || (expectedId && manifest.id !== expectedId)
    || typeof manifest.instanceId !== 'string' || !manifest.instanceId
    || !['FULL', 'INCREMENTAL'].includes(manifest.kind)
    || (manifest.baseBackupId !== null && typeof manifest.baseBackupId !== 'string')
    || (manifest.kind === 'FULL' ? manifest.baseBackupId !== null : typeof manifest.baseBackupId !== 'string')
    || !validDate(manifest.createdAt) || !safeInteger(manifest.lastSequence)
    || !manifest.versions || typeof manifest.versions.schema !== 'string' || !safeInteger(manifest.versions.reducer, 1)
    || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('Неверная схема манифеста резервной копии');
  }
  safeId(manifest.id);
  if (manifest.baseBackupId) safeId(manifest.baseBackupId);
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.name !== 'string' || !categories.has(file.category)
      || !hashPattern.test(file.sha256) || !hashPattern.test(file.assembledSha256)
      || !safeInteger(file.size) || !safeInteger(file.offset) || !safeInteger(file.assembledSize)
      || file.offset + file.size !== file.assembledSize || names.has(file.name)) {
      throw new Error('Неверная схема файла манифеста резервной копии');
    }
    safeName(file.name);
    names.add(file.name);
  }
  if (manifest.journalEvents !== undefined) {
    if (!Array.isArray(manifest.journalEvents)) throw new Error('Неверная схема журнала манифеста');
    for (const event of manifest.journalEvents) {
      if (!safeInteger(event.sequence, 1) || typeof event.eventId !== 'string' || !event.eventId
        || !hashPattern.test(event.hash) || typeof event.branchId !== 'string' || !event.branchId) {
        throw new Error('Неверная схема идентичности события манифеста');
      }
    }
  }
  return structuredClone(manifest);
}

export class BackupService {
  private readonly rootDirectory: string;
  private readonly now: () => Date;
  private readonly audit?: AuditSink;

  constructor(options: { rootDirectory: string; now?: () => Date; audit?: AuditSink }) {
    this.rootDirectory = resolve(options.rootDirectory);
    this.now = options.now ?? (() => new Date());
    this.audit = options.audit;
  }

  async createFullBackup(input: {
    instanceId: string;
    sources: readonly BackupSource[];
    lastSequence: number;
    journalEvents?: readonly JournalEventIdentity[];
    versions: { schema: string; reducer: number };
    auditContext?: OperationAuditContext;
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
    journalEvents?: readonly JournalEventIdentity[];
    versions: { schema: string; reducer: number };
    auditContext?: OperationAuditContext;
  }): Promise<BackupManifest> {
    const base = await this.readManifest(input.baseBackupId);
    if (base.instanceId !== input.instanceId) throw new Error('Базовая копия принадлежит другому сеансу');
    if (!input.sources.length || input.sources.some(source => !['JOURNAL', 'SNAPSHOT'].includes(source.category))) {
      throw new Error('Инкремент содержит только журнал и снимки');
    }
    if (input.lastSequence < base.lastSequence) throw new Error('Инкремент не может откатывать последовательность журнала');
    if (input.sources.every(source => source.category === 'SNAPSHOT') && input.lastSequence > base.lastSequence) {
      throw new Error('Snapshot с новой последовательностью требует журнальный инкремент той же точки');
    }
    return this.create({ ...input, kind: 'INCREMENTAL' }, base);
  }

  async readManifest(backupId: string): Promise<BackupManifest> {
    safeId(backupId);
    const directory = this.directoryFor(backupId);
    await assertDirectoryIfExists(directory, 'Каталог резервной копии');
    const manifestPath = join(directory, 'manifest.json');
    assertPathInside(directory, manifestPath, 'Манифест резервной копии');
    await assertRegularFile(manifestPath, 'Манифест резервной копии');
    return validateBackupManifest(JSON.parse(await readFile(manifestPath, 'utf8')), backupId);
  }

  directoryFor(backupId: string): string {
    safeId(backupId);
    const directory = join(this.rootDirectory, backupId);
    assertPathInside(this.rootDirectory, directory, 'Каталог резервной копии');
    return directory;
  }

  async readBackupFile(backupId: string, name: string): Promise<Buffer> {
    safeName(name);
    const directory = this.directoryFor(backupId);
    const path = join(directory, 'files', name);
    assertPathInside(directory, path, 'Файл резервной копии');
    await assertRegularFile(path, 'Файл резервной копии');
    return readFile(path);
  }

  async verifyBackup(backupId: string, auditContext?: OperationAuditContext): Promise<BackupVerification> {
    if (this.audit && !auditContext) throw new Error('Для аудита копии требуется actor/org операции');
    const manifest = await this.readManifest(backupId);
    const issues: { code: 'HASH_MISMATCH' | 'FILE_MISSING'; name: string }[] = [];
    let checkedFiles = 0;
    for (const file of manifest.files) {
      try {
        const content = await this.readBackupFile(backupId, file.name);
        if (sha256(content) !== file.sha256 || content.byteLength !== file.size) issues.push({ code: 'HASH_MISMATCH', name: file.name });
        checkedFiles += 1;
      } catch (error) {
        if (error instanceof Error && /символическ|корень/.test(error.message)) throw error;
        issues.push({ code: 'FILE_MISSING', name: file.name });
      }
    }
    const result = { valid: issues.length === 0 && checkedFiles === manifest.files.length, checkedFiles, issues };
    this.record(result.valid ? 'backup.verified' : 'backup.verification_failed', backupId, result.valid ? 'ALLOWED' : 'DENIED', auditContext);
    return result;
  }

  private async create(input: {
    instanceId: string;
    sources: readonly BackupSource[];
    lastSequence: number;
    journalEvents?: readonly JournalEventIdentity[];
    versions: { schema: string; reducer: number };
    auditContext?: OperationAuditContext;
    kind: 'FULL' | 'INCREMENTAL';
    baseBackupId: string | null;
  }, base?: BackupManifest): Promise<BackupManifest> {
    if (this.audit && !input.auditContext) throw new Error('Для аудита копии требуется actor/org операции');
    if (!safeInteger(input.lastSequence)) throw new Error('Последовательность копии некорректна');
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
      await assertRegularFile(source.path, 'Источник резервной копии');
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
      ...(input.journalEvents ? { journalEvents: structuredClone(input.journalEvents) } : {}),
    });
    validateBackupManifest(manifest, id);
    await writeFile(join(this.rootDirectory, id, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    this.record(input.kind === 'FULL' ? 'backup.full_created' : 'backup.incremental_created', id, 'ALLOWED', input.auditContext);
    return structuredClone(manifest);
  }

  private record(action: string, resourceId: string, outcome: 'ALLOWED' | 'DENIED', auditContext?: OperationAuditContext): void {
    if (!this.audit) return;
    if (!auditContext) throw new Error('Для аудита копии требуется actor/org операции');
    this.audit.append({ actorId: auditContext.actorId, organizationId: auditContext.organizationId, action, outcome, correlationId: randomUUID(), resourceType: 'backup', resourceId });
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
  const current = Date.parse(input.now);
  const previous = Date.parse(input.lastIncrementalAt);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) throw new Error('Некорректная дата регламента копирования');
  const elapsed = current - previous;
  if (elapsed < 0 || elapsed > 5 * 60 * 1000) throw new Error('Инкремент журнала должен копироваться не реже чем каждые 5 мин');
  if (input.checkpoint !== 'NONE' && !input.checkpointBackupId) throw new Error('Перед скачком или завершением нужна контрольная копия');
}
