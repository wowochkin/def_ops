import { randomUUID } from 'node:crypto';
import type { SecurityAudit } from '../auth/security-audit';
import { appendDurableJsonLine, readDurableJsonLines } from '../auth/durable-jsonl';

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
export type DeletionPorts = Readonly<{
  lockExercise: (exerciseId: string, organizationId: string, requestId: string) => Promise<void>;
  scheduleDeletion: (request: DeletionRequest) => Promise<void>;
  hasRetentionHold: (exerciseId: string, organizationId: string) => Promise<boolean>;
  deleteExercise: (exerciseId: string, organizationId: string, requestId: string) => Promise<void>;
}>;
type DeletionRecord = { type: 'deletion.upsert'; request: DeletionRequest };

export class DeletionService {
  private readonly requests = new Map<string, DeletionRequest>();
  private readonly now: () => Date;
  private readonly audit: SecurityAudit;
  private readonly delayMs: number;
  private readonly ports: DeletionPorts;
  private readonly stateFile?: string;

  constructor(options: { now?: () => Date; audit: SecurityAudit; delayMs?: number; ports: DeletionPorts; stateFile?: string }) {
    this.now = options.now ?? (() => new Date());
    this.audit = options.audit;
    this.delayMs = options.delayMs ?? 24 * 60 * 60 * 1000;
    this.ports = options.ports;
    this.stateFile = options.stateFile;
    for (const record of readDurableJsonLines<DeletionRecord>(this.stateFile)) this.requests.set(record.request.id, record.request);
  }

  async request(actor: DeletionActor, input: { exerciseId: string; organizationId: string }): Promise<DeletionRequest> {
    if (!actor.domainPermissions.includes('exercise.delete')) throw new Error('Требуется специальное полномочие удаления');
    if (actor.organizationId !== input.organizationId) throw new Error('Действие недоступно');
    if (await this.ports.hasRetentionHold(input.exerciseId, input.organizationId)) throw new Error('Удаление запрещено организационным удержанием');
    const timestamp = this.now().getTime();
    const request: DeletionRequest = Object.freeze({
      id: randomUUID(), exerciseId: input.exerciseId, organizationId: input.organizationId,
      requestedBy: actor.userId, confirmedBy: null, requestedAt: new Date(timestamp).toISOString(),
      executeAfter: new Date(timestamp + this.delayMs).toISOString(), status: 'LOCKED', jobId: null,
    });
    await this.ports.lockExercise(input.exerciseId, input.organizationId, request.id);
    this.persist(request);
    this.record('deletion.requested', actor.userId, request);
    return structuredClone(request);
  }

  async confirm(actor: DeletionActor, requestId: string): Promise<DeletionRequest> {
    const request = this.get(requestId);
    if (!actor.domainPermissions.includes('deletion.confirm') || actor.organizationId !== request.organizationId) {
      throw new Error('Недостаточно прав второго уполномоченного лица');
    }
    if (actor.userId === request.requestedBy) throw new Error('Требуется подтверждение вторым лицом');
    if (request.status !== 'LOCKED') throw new Error('Запрос уже подтверждён');
    const confirmed = { ...request, confirmedBy: actor.userId, status: 'SCHEDULED' as const, jobId: randomUUID() };
    await this.ports.scheduleDeletion(confirmed);
    this.persist(confirmed);
    this.record('deletion.confirmed', actor.userId, request);
    return structuredClone(confirmed);
  }

  async execute(requestId: string): Promise<DeletionRequest> {
    const request = this.get(requestId);
    if (request.status === 'LOCKED') throw new Error('Удаление не подтверждено вторым лицом');
    if (request.status === 'EXECUTED') return structuredClone(request);
    if (Date.parse(request.executeAfter) > this.now().getTime()) throw new Error('Удаление отложено по расписанию');
    if (await this.ports.hasRetentionHold(request.exerciseId, request.organizationId)) throw new Error('Удаление остановлено повторной проверкой удержания');
    await this.ports.deleteExercise(request.exerciseId, request.organizationId, request.id);
    const executed = { ...request, status: 'EXECUTED' as const };
    this.persist(executed);
    this.record('deletion.executed', request.confirmedBy ?? request.requestedBy, request);
    return structuredClone(executed);
  }

  async executeDue(): Promise<DeletionRequest[]> {
    const executed: DeletionRequest[] = [];
    for (const request of this.requests.values()) {
      if (request.status === 'SCHEDULED' && Date.parse(request.executeAfter) <= this.now().getTime()) executed.push(await this.execute(request.id));
    }
    return executed;
  }

  private get(requestId: string): DeletionRequest {
    const request = this.requests.get(requestId);
    if (!request) throw new Error('Запрос удаления не найден');
    return request;
  }

  private persist(request: DeletionRequest): void {
    appendDurableJsonLine(this.stateFile, { type: 'deletion.upsert', request } satisfies DeletionRecord);
    this.requests.set(request.id, request);
  }

  private record(action: string, actorId: string, request: DeletionRequest): void {
    this.audit.append({
      actorId, organizationId: request.organizationId, action, outcome: 'ALLOWED',
      correlationId: request.id, resourceType: 'exercise', resourceId: request.exerciseId,
    });
  }
}
