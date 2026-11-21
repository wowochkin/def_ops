export type RetentionPolicy = Readonly<{
  organizationId: string;
  activeDays: number;
  archiveDays: number;
  backupDays: number;
  auditDays: number;
  allowedMedia: readonly string[];
  responsibleUserIds: readonly string[];
}>;
export type RetentionClass = 'ACTIVE' | 'ARCHIVE' | 'BACKUP' | 'AUDIT';

export class RetentionService {
  private readonly policies = new Map<string, RetentionPolicy>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  setPolicy(policy: RetentionPolicy): void {
    if ([policy.activeDays, policy.archiveDays, policy.backupDays, policy.auditDays].some(days => !Number.isInteger(days) || days <= 0)) {
      throw new Error('Сроки хранения должны быть положительными целыми числами');
    }
    if (!policy.responsibleUserIds.length) throw new Error('Назначьте ответственного за хранение');
    this.policies.set(policy.organizationId, structuredClone(policy));
  }

  expiresAt(organizationId: string, retentionClass: RetentionClass, from?: string): string {
    const policy = this.policy(organizationId);
    const days = { ACTIVE: policy.activeDays, ARCHIVE: policy.archiveDays, BACKUP: policy.backupDays, AUDIT: policy.auditDays }[retentionClass];
    const start = from ? new Date(from) : this.now();
    return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  assertMediumAllowed(organizationId: string, medium: string): void {
    if (!this.policy(organizationId).allowedMedia.includes(medium)) throw new Error('Указанный носитель не разрешён политикой хранения');
  }

  canReadArchive(organizationId: string, sourcePermissions: readonly string[], actorPermissions: readonly string[], disclosureDecision: boolean): boolean {
    this.policy(organizationId);
    if (disclosureDecision) return true;
    return sourcePermissions.every(permission => actorPermissions.includes(permission));
  }

  private policy(organizationId: string): RetentionPolicy {
    const policy = this.policies.get(organizationId);
    if (!policy) throw new Error('Политика хранения организации не задана');
    return policy;
  }
}
