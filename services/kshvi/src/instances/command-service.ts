import { randomUUID } from 'node:crypto';
import { ConductCommandService } from './conduct-command-service';
import { assertDomainOperationType } from './typed-command-port';
import type { ConductCommand, ConductOperations } from '../../../../packages/kshvi/src/commands/conduct';
import type { ChainEvent } from '../../../../packages/kshvi/src/events/envelope';
import type { KshviEventStore } from '../store/event-store';

export type InstanceCommand = {
  instanceId: string;
  branchId: string;
  expectedRevision: number;
  idempotencyKey: string;
  type: string;
  at?: string;
  payload?: unknown;
  actor: { userId: string; role: string; organizationId: string; sideId?: string; assignedNodeIds?: readonly string[]; authorities?: readonly string[] };
};
export type CommandResult = { eventId: string; revision: number; idempotent: boolean };
function normalizeSeedValues(value: unknown, key?: string): unknown {
  if (key === 'seed' && typeof value === 'string' && /^\d+n?$/.test(value)) return BigInt(value.replace(/n$/, ''));
  if (Array.isArray(value)) return value.map(item => normalizeSeedValues(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, normalizeSeedValues(child, childKey)]));
  return value;
}

const officialTypes = new Set([
  'decision.create', 'decision.transition', 'decision.revise', 'branch.adopt', 'order.issue', 'order.advance', 'order.cancel',
  'calculation.create', 'calculation.approve', 'calculation.apply', 'calculation.override', 'calculation.replay',
  'observation.record', 'document.create', 'document.transition', 'document.edit', 'document.approval', 'document.conflict.resolve',
  'document.cascade.issue', 'document.cascade.advance', 'document.cascade.fact', 'document.revise',
  'input.planned', 'input.reactive', 'input.adaptive', 'input.approve', 'trigger.validate',
  'communication.enqueue', 'communication.admit', 'communication.advance', 'communication.retry', 'communication.failure', 'communication.infrastructure',
  'report.check', 'paper.record', 'environment.bind', 'weather.change',
  'time.pause', 'time.rate', 'time.resume', 'time.jump', 'stage.assign', 'playbook.evaluate', 'exercise.complete',
]);

export class CommandService {
  private readonly results = new Map<string, CommandResult & { eventId: string }>();
  private readonly revisions = new Map<string, number>();
  private readonly official: ConductCommandService;
  private readonly eventSink?: (event: ChainEvent) => void | Promise<void>;

  constructor(options: { store?: KshviEventStore; organizationId?: string; operations?: ConductOperations; eventSink?: (event: ChainEvent) => void | Promise<void> } = {}) {
    this.official = new ConductCommandService(options);
    this.eventSink = options.eventSink;
  }

  async execute(input: InstanceCommand): Promise<CommandResult> {
    if (officialTypes.has(input.type)) {
      const metadata = new Set(['instanceId', 'branchId', 'expectedRevision', 'idempotencyKey', 'type', 'at', 'actor', 'payload']);
      const commandInput = input.payload === undefined
        ? Object.fromEntries(Object.entries(input).filter(([key]) => !metadata.has(key)))
        : input.payload;
      const payload = commandInput && typeof commandInput === 'object' && !Array.isArray(commandInput) ? normalizeSeedValues(commandInput) as Record<string, unknown> : {};
      const at = input.at ?? (typeof payload.at === 'string' ? payload.at : '');
      const result = await this.official.execute({
        sessionId: input.instanceId, branchId: input.branchId, expectedRevision: input.expectedRevision, actor: input.actor,
      }, { ...payload, type: input.type, commandId: input.idempotencyKey, at } as ConductCommand);
      if (!result.idempotent && this.eventSink) await this.eventSink(result.event);
      return { eventId: result.event.eventId, revision: result.revision, idempotent: result.idempotent };
    }
    if (input.actor.role === 'SYSTEM') {
      assertDomainOperationType(input.type);
      const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {};
      const at = input.at ?? (typeof payload.at === 'string' ? payload.at : new Date().toISOString());
      const result = await this.official.executeDomain({
        sessionId: input.instanceId, branchId: input.branchId, expectedRevision: input.expectedRevision, actor: input.actor,
      }, { commandId: input.idempotencyKey, type: input.type, payload, at });
      if (!result.idempotent && this.eventSink) await this.eventSink(result.event);
      return { eventId: result.event.eventId, revision: result.revision, idempotent: result.idempotent };
    }
    const key = `${input.instanceId}/${input.idempotencyKey}`;
    const existing = this.results.get(key);
    if (existing) return { ...existing, idempotent: true };
    if (input.actor.role !== 'LEADER') throw new Error('403: Команда недоступна');
    const branchKey = `${input.instanceId}/${input.branchId}`;
    const revision = this.revisions.get(branchKey) ?? 0;
    if (input.expectedRevision !== revision) throw new Error(`Устаревшая ревизия: ${input.expectedRevision}, актуальная ${revision}`);
    const result = { eventId: randomUUID(), revision: revision + 1, idempotent: false };
    this.results.set(key, result);
    this.revisions.set(branchKey, result.revision);
    return result;
  }

  async history(instanceId: string, branchId: string): Promise<ChainEvent[]> {
    return this.official.history(instanceId, branchId);
  }

  state(instanceId: string, branchId: string) {
    return this.official.state(instanceId, branchId);
  }
}
