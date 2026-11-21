import { randomUUID } from 'node:crypto';
import type { SessionMode } from './organization-policy';

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

export class AssignmentService {
  private readonly assignments = new Map<string, RoleAssignment>();
  private readonly subscriptionRevisions = new Map<string, number>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
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
    this.assignments.set(assignment.id, assignment);
    this.bumpSubscriptionRevision(input.userId);
    return structuredClone(assignment);
  }

  revoke(actor: AssignmentActor, assignmentId: string): RoleAssignment {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new Error('Назначение не найдено');
    this.assertManager(actor, assignment.organizationId);
    const revoked = { ...assignment, state: 'REVOKED' as const, revision: assignment.revision + 1 };
    this.assignments.set(assignmentId, revoked);
    this.bumpSubscriptionRevision(assignment.userId);
    return structuredClone(revoked);
  }

  authorize(userId: string, request: {
    action: string;
    organizationId: string;
    instanceId: string;
    sideId?: string;
    areaId?: string;
  }): { allowed: boolean } {
    const timestamp = this.now().getTime();
    const allowed = [...this.assignments.values()].some(assignment => assignment.userId === userId
      && assignment.state === 'ACTIVE'
      && assignment.organizationId === request.organizationId
      && assignment.instanceId === request.instanceId
      && assignment.allowedActions.includes(request.action)
      && Date.parse(assignment.validFrom) <= timestamp && timestamp < Date.parse(assignment.validUntil)
      && (!request.sideId || assignment.sideId === request.sideId)
      && (!request.areaId || assignment.areaId === request.areaId));
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
      throw new Error('Недостаточно предметные права для назначения роли');
    }
  }

  private bumpSubscriptionRevision(userId: string): void {
    this.subscriptionRevisions.set(userId, this.subscriptionRevision(userId) + 1);
  }
}

export function copyAssignmentsForSession(_sourceMode: SessionMode, targetMode: SessionMode): string[] {
  return targetMode === 'OFFICIAL' ? [] : ['CREATE_NEW_ASSIGNMENTS'];
}
