import { randomUUID } from 'node:crypto';
import type { SessionMode } from './organization-policy';
import { appendDurableJsonLine, readDurableJsonLines, type AuditSink } from './durable-jsonl';

export type AssignmentActor = Readonly<{
  userId: string;
  organizationId: string;
  domainPermissions: readonly string[];
}>;
export type RoleAssignment = Readonly<{
  id: string;
  userId: string;
  organizationId: string;
  instanceId: string;
  postId: string;
  role: string;
  sideId: string | null;
  areaId: string | null;
  sessionMode: SessionMode;
  validFrom: string;
  validUntil: string;
  allowedActions: readonly string[];
  substituteUserId: string | null;
  critical: boolean;
  state: 'ACTIVE' | 'REVOKED';
  revision: number;
}>;
export type AssignmentInput = Omit<RoleAssignment, 'id' | 'state' | 'revision'>;
export type ResourceScope = Readonly<{
  organizationId: string;
  instanceId: string;
  sideId: string | null;
  areaId: string | null;
}>;
export type ScopeResolver = (resourceId: string) => ResourceScope | null;
type AssignmentRecord = { type: 'assignment.upsert'; assignment: RoleAssignment; subscriptionRevision: number };

export class AssignmentService {
  private readonly assignments = new Map<string, RoleAssignment>();
  private readonly subscriptionRevisions = new Map<string, number>();
  private readonly now: () => Date;
  private readonly stateFile?: string;
  private readonly audit?: AuditSink;

  constructor(options: { now?: () => Date; stateFile?: string; audit?: AuditSink } = {}) {
    this.now = options.now ?? (() => new Date());
    this.stateFile = options.stateFile;
    this.audit = options.audit;
    for (const record of readDurableJsonLines<AssignmentRecord>(this.stateFile)) {
      this.assignments.set(record.assignment.id, record.assignment);
      this.subscriptionRevisions.set(record.assignment.userId, record.subscriptionRevision);
    }
  }

  assign(actor: AssignmentActor, input: AssignmentInput): RoleAssignment {
    this.assertManager(actor, input.organizationId);
    if (Date.parse(input.validFrom) >= Date.parse(input.validUntil)) throw new Error('Срок назначения некорректен');
    if (input.sessionMode === 'OFFICIAL') {
      const conflict = [...this.assignments.values()].find(existing => existing.state === 'ACTIVE'
        && existing.userId === input.userId && existing.instanceId === input.instanceId
        && existing.sessionMode === 'OFFICIAL'
        && Date.parse(existing.validFrom) < Date.parse(input.validUntil)
        && Date.parse(input.validFrom) < Date.parse(existing.validUntil));
      if (conflict) throw new Error('Конфликт ролей в официальном сеансе');
    }
    const assignment: RoleAssignment = Object.freeze({
      ...input, allowedActions: Object.freeze([...input.allowedActions]),
      id: randomUUID(), state: 'ACTIVE', revision: 1,
    });
    this.persist(assignment);
    this.record('assignment.granted', actor.userId, assignment);
    return structuredClone(assignment);
  }

  revoke(actor: AssignmentActor, assignmentId: string): RoleAssignment {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new Error('Назначение не найдено');
    this.assertManager(actor, assignment.organizationId);
    const revoked = { ...assignment, state: 'REVOKED' as const, revision: assignment.revision + 1 };
    this.persist(revoked);
    this.record('assignment.revoked', actor.userId, revoked);
    return structuredClone(revoked);
  }

  authorize(userId: string, request: {
    action: string;
    organizationId: string;
    instanceId: string;
    resourceId: string;
  }, resolveScope?: ScopeResolver): { allowed: boolean } {
    if (!resolveScope) return { allowed: false };
    const scope = resolveScope(request.resourceId);
    if (!scope || scope.organizationId !== request.organizationId || scope.instanceId !== request.instanceId) return { allowed: false };
    const timestamp = this.now().getTime();
    const allowed = [...this.assignments.values()].some(assignment => assignment.userId === userId
      && assignment.state === 'ACTIVE'
      && assignment.organizationId === scope.organizationId
      && assignment.instanceId === scope.instanceId
      && assignment.allowedActions.includes(request.action)
      && Date.parse(assignment.validFrom) <= timestamp && timestamp < Date.parse(assignment.validUntil)
      && (assignment.sideId === null || assignment.sideId === scope.sideId)
      && (assignment.areaId === null || assignment.areaId === scope.areaId));
    if (!allowed) this.audit?.append({
      actorId: userId, organizationId: request.organizationId, action: 'assignment.access.denied', outcome: 'DENIED',
      correlationId: randomUUID(), resourceType: 'resource', resourceId: request.resourceId,
    });
    return { allowed };
  }

  subscriptionRevision(userId: string): number {
    return this.subscriptionRevisions.get(userId) ?? 0;
  }

  history(assignmentId: string): RoleAssignment[] {
    const assignment = this.assignments.get(assignmentId);
    return assignment ? [structuredClone(assignment)] : [];
  }

  preflight(instanceId: string, requiredPosts: readonly { postId: string; critical: boolean }[]): Array<{ code: string; postId: string }> {
    const timestamp = this.now().getTime();
    return requiredPosts.filter(post => post.critical).flatMap(post => {
      const ready = [...this.assignments.values()].some(assignment => assignment.instanceId === instanceId
        && assignment.postId === post.postId && assignment.state === 'ACTIVE' && assignment.substituteUserId
        && Date.parse(assignment.validFrom) <= timestamp && timestamp < Date.parse(assignment.validUntil));
      return ready ? [] : [{ code: 'CRITICAL_POST_UNFILLED', postId: post.postId }];
    });
  }

  private assertManager(actor: AssignmentActor, organizationId: string): void {
    if (actor.organizationId !== organizationId || !actor.domainPermissions.includes('assignment.manage')) {
      throw new Error('Недостаточны предметные права для назначения роли');
    }
  }

  private persist(assignment: RoleAssignment): void {
    const subscriptionRevision = this.subscriptionRevision(assignment.userId) + 1;
    appendDurableJsonLine(this.stateFile, { type: 'assignment.upsert', assignment, subscriptionRevision } satisfies AssignmentRecord);
    this.assignments.set(assignment.id, assignment);
    this.subscriptionRevisions.set(assignment.userId, subscriptionRevision);
  }

  private record(action: string, actorId: string, assignment: RoleAssignment): void {
    this.audit?.append({
      actorId, organizationId: assignment.organizationId, action, outcome: 'ALLOWED', correlationId: randomUUID(),
      resourceType: 'assignment', resourceId: assignment.id,
    });
  }
}

export function copyAssignmentsForSession(_sourceMode: SessionMode, targetMode: SessionMode): string[] {
  return targetMode === 'OFFICIAL' ? [] : ['CREATE_NEW_ASSIGNMENTS'];
}
