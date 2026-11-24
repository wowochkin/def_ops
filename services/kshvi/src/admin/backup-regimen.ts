import type { BackupManifest, BackupService, BackupSource, JournalEventIdentity } from './backup-service';
import type { OperationAuditContext } from '../auth/durable-jsonl';

export type BackupRegimenInput = Readonly<{
  sources: readonly BackupSource[];
  lastSequence: number;
  journalEvents?: readonly JournalEventIdentity[];
  versions: { schema: string; reducer: number };
  auditContext?: OperationAuditContext;
}>;

export class BackupRegimen {
  private readonly history: BackupManifest[] = [];
  private latestBackupId: string | null = null;
  private latestJournalBackupId: string | null = null;
  private lastIncrementalAt: number | null = null;
  private lastSnapshotAt: number | null = null;
  private lastSequence = -1;

  constructor(private readonly options: {
    backups: BackupService;
    instanceId: string;
    now: () => Date;
    input: () => Promise<BackupRegimenInput>;
    snapshotIntervalMs?: number;
  }) {}

  async prestart(): Promise<BackupManifest> {
    if (this.latestBackupId) throw new Error('Предстартовая копия уже создана');
    const full = await this.options.backups.createFullBackup({ instanceId: this.options.instanceId, ...await this.options.input() });
    this.latestBackupId = full.id;
    this.latestJournalBackupId = full.id;
    this.lastIncrementalAt = Date.parse(full.createdAt);
    this.lastSnapshotAt = this.lastIncrementalAt;
    this.lastSequence = full.lastSequence;
    this.history.push(full);
    return structuredClone(full);
  }

  async tick(): Promise<BackupManifest[]> {
    if (!this.latestBackupId || this.lastIncrementalAt === null || this.lastSnapshotAt === null) throw new Error('Сначала создайте предстартовую копию');
    const now = this.options.now().getTime();
    const input = await this.options.input();
    const created: BackupManifest[] = [];
    const incrementalDue = now - this.lastIncrementalAt >= 300_000;
    const snapshotDue = now - this.lastSnapshotAt >= (this.options.snapshotIntervalMs ?? 300_000);
    if ((incrementalDue || snapshotDue) && input.lastSequence > this.lastSequence) {
      created.push(await this.incremental(input, 'JOURNAL'));
      this.lastSequence = input.lastSequence;
    }
    if (incrementalDue) this.lastIncrementalAt = now;
    if (snapshotDue) {
      created.push(await this.incremental(input, 'SNAPSHOT'));
      this.lastSnapshotAt = now;
    }
    return created;
  }

  async checkpoint(_reason: 'BEFORE_JUMP' | 'BEFORE_FINISH'): Promise<BackupManifest> {
    if (!this.latestBackupId) throw new Error('Сначала создайте предстартовую копию');
    const full = await this.options.backups.createFullBackup({ instanceId: this.options.instanceId, ...await this.options.input() });
    this.latestBackupId = full.id;
    this.latestJournalBackupId = full.id;
    this.lastIncrementalAt = this.options.now().getTime();
    this.lastSnapshotAt = this.lastIncrementalAt;
    this.lastSequence = full.lastSequence;
    this.history.push(full);
    return structuredClone(full);
  }

  manifests(): BackupManifest[] {
    return this.history.map(manifest => structuredClone(manifest));
  }

  private async incremental(input: BackupRegimenInput, category: 'JOURNAL' | 'SNAPSHOT'): Promise<BackupManifest> {
    const baseBackupId = this.latestJournalBackupId;
    if (!baseBackupId) throw new Error('Базовая копия отсутствует');
    const sources = input.sources.filter(source => source.category === category);
    if (!sources.length) throw new Error(`Источник ${category} отсутствует`);
    const manifest = await this.options.backups.createIncrementalBackup({
      instanceId: this.options.instanceId,
      baseBackupId,
      sources,
      lastSequence: input.lastSequence,
      ...(input.journalEvents ? { journalEvents: input.journalEvents } : {}),
      versions: input.versions,
      ...(input.auditContext ? { auditContext: input.auditContext } : {}),
    });
    this.latestBackupId = manifest.id;
    if (category === 'JOURNAL') this.latestJournalBackupId = manifest.id;
    this.history.push(manifest);
    return manifest;
  }
}
