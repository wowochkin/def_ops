import { randomUUID } from 'node:crypto';

export type TemporaryAccessGrant = Readonly<{
  id: string;
  subjectUserId: string;
  organizationId: string;
  resourceId: string;
  reason: string;
  validFrom: string;
  validUntil: string;
  grantedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
}>;
export type TemporaryAccessRequest = {
  action: string;
  organizationId: string;
  resourceId?: string;
  correlationId?: string;
};
type AuditSink = { append(input: Record<string, unknown>): unknown };

export class TemporaryAccessService {
  private readonly grants = new Map<string, TemporaryAccessGrant>();
  private readonly now: () => Date;
  private readonly audit?: AuditSink;

  constructor(options: { now?: () => Date; audit?: AuditSink } = {}) {
    this.now = options.now ?? (() => new Date());
    this.audit = options.audit;
  }

  grant(actor: { userId: string; organizationId: string; technicalPermissions: readonly string[] }, input: {
    subjectUserId: string;
    organizationId: string;
    resourceId: string;
    reason: string;
    validFrom: string;
    validUntil: string;
  }): TemporaryAccessGrant {
    if (!actor.technicalPermissions.includes('temporary-access.grant') || actor.organizationId !== input.organizationId) {
      throw new Error('Недостаточно технических прав для временного доступа');
    }
    if (input.reason.trim().length < 10) throw new Error('Укажите содержательную причину временного доступа');
    const validFrom = Date.parse(input.validFrom);
    const validUntil = Date.parse(input.validUntil);
    if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validFrom >= validUntil) throw new Error('Срок временного доступа некорректен');
    const grant: TemporaryAccessGrant = Object.freeze({
      id: randomUUID(), ...input, reason: input.reason.trim(), grantedBy: actor.userId, revokedAt: null, revokedBy: null,
    });
    this.grants.set(grant.id, grant);
    this.record('temporary.access.granted', actor.userId, grant.organizationId, grant.id, grant.resourceId);
    return structuredClone(grant);
  }

  canAccess(grantId: string, request: TemporaryAccessRequest): boolean {
    const grant = this.grants.get(grantId);
    if (!grant) return false;
    const timestamp = this.now().getTime();
    const allowed = !grant.revokedAt
      && timestamp >= Date.parse(grant.validFrom)
      && timestamp < Date.parse(grant.validUntil)
      && request.action === 'recovery.content.read'
      && request.organizationId === grant.organizationId
      && request.resourceId === grant.resourceId;
    this.record(allowed ? 'temporary.access.used' : 'temporary.access.denied', grant.subjectUserId, grant.organizationId, grant.id, grant.resourceId, request.correlationId);
    return allowed;
  }

  canAccessForUser(subjectUserId: string, request: TemporaryAccessRequest): boolean {
    return [...this.grants.values()].some(grant => grant.subjectUserId === subjectUserId && this.canAccess(grant.id, request));
  }

  revoke(grantId: string, actorUserId: string): TemporaryAccessGrant {
    const grant = this.grants.get(grantId);
    if (!grant) throw new Error('Временное разрешение не найдено');
    const updated = { ...grant, revokedAt: this.now().toISOString(), revokedBy: actorUserId };
    this.grants.set(grantId, updated);
    this.record('temporary.access.revoked', actorUserId, grant.organizationId, grant.id, grant.resourceId);
    return structuredClone(updated);
  }

  private record(action: string, actorId: string, organizationId: string, correlationId: string, resourceId: string, requestCorrelationId?: string): void {
    this.audit?.append({
      actorId, organizationId, action, outcome: action.endsWith('denied') ? 'DENIED' : 'ALLOWED',
      correlationId: requestCorrelationId ?? correlationId, resourceType: 'temporary-access', resourceId,
    });
  }
}
