import { randomUUID } from 'node:crypto';
import type { SecurityAudit } from '../auth/security-audit';

export type DeletionActor = Readonly<{
  userId: string;
  organizationId: string;
  domainPermissions: readonly string[];
}>;
export type DeletionRequest = Readonly<{
  id: string;
  exerciseId: string;
  organizationId: string;
  requestedBy: string;
  confirmedBy: string | null;
  requestedAt: string;
  executeAfter: string;
  status: 'LOCKED' | 'SCHEDULED' | 'EXECUTED';
  jobId: string | null;
}>;

export class DeletionService {
  private readonly requests = new Map<string, DeletionRequest>();
  private readonly now: () => Date;
  private readonly audit: SecurityAudit;
  private readonly delayMs: number;

  constructor(options: { now?: () => Date; audit: SecurityAudit; delayMs?: number }) {
    this.now = options.now ?? (() => new Date());
    this.audit = options.audit;
    this.delayMs = options.delayMs ?? 24 * 60 * 60 * 1000;
  }

  request(actor: DeletionActor, input: { exerciseId: string; organizationId: string; retentionHold: boolean }): DeletionRequest {
    if (!actor.domainPermissions.includes('exercise.delete')) throw new Error('Требуется специальное полномочие удаления');
    if (actor.organizationId !== input.organizationId) throw new Error('Действие недоступно');
    if (input.retentionHold) throw new Error('Удаление запрещено организационным удержанием');
    const timestamp = this.now().getTime();
    const request: DeletionRequest = Object.freeze({
      id: randomUUID(), exerciseId: input.exerciseId, organizationId: input.organizationId,
      requestedBy: actor.userId, confirmedBy: null, requestedAt: new Date(timestamp).toISOString(),
      executeAfter: new Date(timestamp + this.delayMs).toISOString(), status: 'LOCKED', jobId: null,
    });
    this.requests.set(request.id, request);
    this.record('deletion.requested', actor.userId, request);
    return structuredClone(request);
  }

  confirm(actor: DeletionActor, requestId: string): DeletionRequest {
    const request = this.get(requestId);
    if (!actor.domainPermissions.includes('deletion.confirm') || actor.organizationId !== request.organizationId) {
      throw new Error('Недостаточно прав второго уполномоченного лица');
    }
    if (actor.userId === request.requestedBy) throw new Error('Требуется подтверждение вторым лицом');
    if (request.status !== 'LOCKED') throw new Error('Запрос уже подтверждён');
    const confirmed = { ...request, confirmedBy: actor.userId, status: 'SCHEDULED' as const, jobId: randomUUID() };
    this.requests.set(requestId, confirmed);
    this.record('deletion.confirmed', actor.userId, request);
    return structuredClone(confirmed);
  }

  execute(requestId: string): DeletionRequest {
    const request = this.get(requestId);
    if (request.status === 'LOCKED') throw new Error('Удаление не подтверждено вторым лицом');
    if (request.status === 'EXECUTED') return structuredClone(request);
    if (Date.parse(request.executeAfter) > this.now().getTime()) throw new Error('Удаление отложено по расписанию');
    const executed = { ...request, status: 'EXECUTED' as const };
    this.requests.set(requestId, executed);
    this.record('deletion.executed', request.confirmedBy ?? request.requestedBy, request);
    return structuredClone(executed);
  }

  private get(requestId: string): DeletionRequest {
    const request = this.requests.get(requestId);
    if (!request) throw new Error('Запрос удаления не найден');
    return request;
  }

  private record(action: string, actorId: string, request: DeletionRequest): void {
    this.audit.append({
      actorId, organizationId: request.organizationId, action, outcome: 'ALLOWED',
      correlationId: request.id, resourceType: 'exercise', resourceId: request.exerciseId,
    });
  }
}
