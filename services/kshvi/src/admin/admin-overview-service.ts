import type { ParticipantContext } from '../auth/authorize';
import type { LocalAccountPublic } from '../auth/local-directory';
import { AssignmentService } from '../auth/assignment-service';
import { SecurityAudit } from '../auth/security-audit';
import { ConfigCatalog } from './config-catalog';
import { HealthService } from './health-service';
import type { OfflineDataSet } from './offline-assets';

export type AdminAccountPublic = Omit<LocalAccountPublic, 'createdAt' | 'updatedAt'> & { createdAt: string | null; updatedAt: string | null };
type MaybePromise<T> = T | Promise<T>;
export interface AdminAccountDirectory {
  listPublic(organizationId: string): MaybePromise<AdminAccountPublic[]>;
  blockAccount(userId: string): MaybePromise<AdminAccountPublic>;
  archiveAccount(userId: string): MaybePromise<AdminAccountPublic>;
}

export class AdminOverviewService {
  constructor(readonly options: {
    directory: AdminAccountDirectory;
    assignments: AssignmentService;
    configs: ConfigCatalog;
    audit: SecurityAudit;
    health?: HealthService;
    datasets?: readonly OfflineDataSet[];
    now?: () => Date;
  }) {}

  async overview(actor: ParticipantContext) {
    const now = this.options.now?.() ?? new Date();
    const health = this.options.health ?? new HealthService({ eventQueueThreshold: 1000, maxClockOffsetMs: 1000 });
    return {
      accounts: await this.options.directory.listPublic(actor.organizationId),
      assignments: this.options.assignments.list(actor.organizationId),
      events: this.options.audit.entries().filter(event => event.organizationId === actor.organizationId),
      versions: this.options.configs.list(),
      datasets: structuredClone(this.options.datasets ?? []),
      retention: {
        activeDays: 30, archiveDays: 365, backupDays: 90, auditDays: 730,
        allowedMedia: ['encrypted-local-disk'], responsibleUserIds: ['security-1'],
      },
      snapshot: health.evaluate({
        services: { kshvi: 'UP', database: 'UP', environment: 'UP' },
        connections: { active: 0, idle: 0, disconnected: 0 }, queues: { events: 0, jobs: 0, heavyJobs: 0 },
        latencyMs: { commandP95: 0, sseP95: 0, mapP95: 0 }, storage: { freeBytes: 0, journalBytes: 0 },
        backups: { status: 'STALE', lastVerifiedAt: null },
        clock: { serverTime: now.toISOString(), ntpSynchronized: true, offsetMs: 0 }, versions: { kshvi: '0.1.0' }, errors: [],
      }),
    };
  }
}
