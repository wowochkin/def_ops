import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { appendToChain } from '../../../../packages/kshvi/src/events/hash-chain';
import type { ChainEvent } from '../../../../packages/kshvi/src/events/envelope';
import { emptyConductState, executeConductCommand, type ConductActor, type ConductCommand, type ConductExecution, type ConductState } from '../../../../packages/kshvi/src/commands/conduct';
import type { KshviEventStore } from '../store/event-store';

export type ConductCommandContext = Readonly<{
  sessionId: string;
  branchId: string;
  expectedRevision: number;
  actor: ConductActor;
}>;
export type ConductCommandResult = ConductExecution & Readonly<{ idempotent: boolean }>;
type StoredResult = { request: string; result: ConductCommandResult };

export class ConductCommandService {
  private readonly states = new Map<string, ConductState>();
  private readonly commands = new Map<string, StoredResult>();
  private readonly events = new Map<string, ChainEvent[]>();
  private readonly store?: KshviEventStore;
  private readonly organizationId?: string;

  constructor(options: { store?: KshviEventStore; organizationId?: string } = {}) {
    this.store = options.store;
    this.organizationId = options.organizationId;
  }

  private key(sessionId: string, branchId: string): string { return `${sessionId}/${branchId}`; }
  state(sessionId: string, branchId: string): ConductState {
    const key = this.key(sessionId, branchId);
    const existing = this.states.get(key);
    if (existing) return structuredClone(existing);
    const created = emptyConductState(sessionId);
    this.states.set(key, created);
    return structuredClone(created);
  }

  async execute(context: ConductCommandContext, command: ConductCommand): Promise<ConductCommandResult> {
    const commandKey = `${this.key(context.sessionId, context.branchId)}/${command.commandId}`;
    const request = canonicalJson(command);
    const previous = this.commands.get(commandKey);
    if (previous) {
      if (previous.request !== request) throw new Error('Идемпотентный ключ уже использован с другой командой');
      return { ...structuredClone(previous.result), idempotent: true };
    }
    const current = this.state(context.sessionId, context.branchId);
    if (current.revision !== context.expectedRevision) throw new Error(`Устаревшая ревизия: ${context.expectedRevision}, актуальная ${current.revision}`);
    const execution = await executeConductCommand(current, command, context.actor);
    let event = execution.event as ChainEvent;
    if (this.store) {
      const persisted = await this.store.appendCommand({
        organizationId: this.organizationId ?? context.actor.organizationId,
        instanceId: context.sessionId,
        branchId: context.branchId,
        aggregateRevision: context.expectedRevision,
        idempotencyKey: command.commandId,
        eventId: execution.event.eventId,
        type: execution.event.type,
        payload: execution.event.payload,
      });
      if (persisted.eventId !== execution.event.eventId) throw new Error('Хранилище изменило идентификатор официального события');
      event = { ...execution.event, prevHash: persisted.prevHash, hash: persisted.hash };
    } else {
      event = appendToChain(this.events.get(this.key(context.sessionId, context.branchId)) ?? [], execution.event);
    }
    const key = this.key(context.sessionId, context.branchId);
    this.states.set(key, structuredClone(execution.state));
    this.events.set(key, [...this.events.get(key) ?? [], event]);
    const result: ConductCommandResult = { ...execution, event, idempotent: false };
    this.commands.set(commandKey, { request, result: structuredClone(result) });
    return result;
  }

  async history(sessionId: string, branchId: string): Promise<ChainEvent[]> {
    if (this.store) return this.store.listEvents(sessionId, branchId);
    return structuredClone(this.events.get(this.key(sessionId, branchId)) ?? []);
  }
}
