import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '@def-ops/kshvi';
import { appendDurableJsonLine, readDurableJsonLines } from './durable-jsonl';

export type SecurityAuditEvent = Readonly<{
  sequence: number;
  eventId: string;
  occurredAt: string;
  actorId: string;
  organizationId: string;
  action: string;
  outcome: 'ALLOWED' | 'DENIED';
  correlationId: string;
  resourceType?: string;
  resourceId?: string;
  prevHash: string | null;
  hash: string;
}>;
export type SecurityAuditInput = {
  actorId: string;
  organizationId: string;
  action: string;
  outcome: 'ALLOWED' | 'DENIED';
  correlationId: string;
  resourceType?: string;
  resourceId?: string;
} & Record<string, unknown>;
export type AuditActor = Readonly<{
  userId: string;
  organizationId: string;
  technicalPermissions: readonly string[];
}>;

function hashEvent(event: Omit<SecurityAuditEvent, 'hash'>): string {
  return createHash('sha256').update(canonicalJson(event)).digest('hex');
}

export class SecurityAudit {
  private readonly events: SecurityAuditEvent[] = [];
  private readonly now: () => Date;
  private readonly stateFile?: string;

  constructor(options: { now?: () => Date; stateFile?: string } = {}) {
    this.now = options.now ?? (() => new Date());
    this.stateFile = options.stateFile;
    const restored = readDurableJsonLines<SecurityAuditEvent>(this.stateFile);
    const issues = this.verify(restored);
    if (issues.length) throw new Error(`Повреждена хеш-цепочка аудита: ${issues.join(', ')}`);
    this.events.push(...restored);
  }

  append(input: SecurityAuditInput): SecurityAuditEvent {
    const previous = this.events.at(-1);
    const withoutHash: Omit<SecurityAuditEvent, 'hash'> = {
      sequence: (previous?.sequence ?? 0) + 1,
      eventId: randomUUID(),
      occurredAt: this.now().toISOString(),
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: input.action,
      outcome: input.outcome,
      correlationId: input.correlationId,
      ...(typeof input.resourceType === 'string' ? { resourceType: input.resourceType } : {}),
      ...(typeof input.resourceId === 'string' ? { resourceId: input.resourceId } : {}),
      prevHash: previous?.hash ?? null,
    };
    const event = Object.freeze({ ...withoutHash, hash: hashEvent(withoutHash) });
    appendDurableJsonLine(this.stateFile, event);
    this.events.push(event);
    return structuredClone(event);
  }

  entries(): SecurityAuditEvent[] {
    return this.events.map(event => structuredClone(event));
  }

  entriesForOrganization(organizationId: string): SecurityAuditEvent[] {
    return this.events.filter(event => event.organizationId === organizationId).map(event => structuredClone(event));
  }

  verify(events: readonly SecurityAuditEvent[] = this.events): string[] {
    const issues: string[] = [];
    let previous: SecurityAuditEvent | undefined;
    for (const event of events) {
      if (event.sequence !== (previous?.sequence ?? 0) + 1) issues.push(`SEQUENCE:${event.sequence}`);
      if (event.prevHash !== (previous?.hash ?? null)) issues.push(`PREV_HASH:${event.sequence}`);
      const { hash, ...withoutHash } = event;
      if (hashEvent(withoutHash) !== hash) issues.push(`HASH:${event.sequence}`);
      previous = event;
    }
    return issues;
  }

  export(actor: AuditActor, correlationId: string): SecurityAuditEvent[] {
    if (!actor.technicalPermissions.includes('audit.export')) {
      this.append({ actorId: actor.userId, organizationId: actor.organizationId, action: 'audit.export.denied', outcome: 'DENIED', correlationId });
      throw new Error('Для экспорта аудита требуется полномочие audit.export');
    }
    this.append({ actorId: actor.userId, organizationId: actor.organizationId, action: 'audit.exported', outcome: 'ALLOWED', correlationId });
    return this.entriesForOrganization(actor.organizationId);
  }
}
