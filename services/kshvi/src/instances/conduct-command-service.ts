import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { appendToChain } from '../../../../packages/kshvi/src/events/hash-chain';
import type { ChainEvent, ChainEventInput } from '../../../../packages/kshvi/src/events/envelope';
import { operationalAt, wallClockAt } from '../../../../packages/kshvi/src/model/unknown';
import { cloneWorld } from '../../../../packages/kshvi/src/model/world';
import { emptyConductState, executeConductCommand, type ConductActor, type ConductCommand, type ConductExecution, type ConductOperations, type ConductState } from '../../../../packages/kshvi/src/commands/conduct';
import type { KshviEventStore } from '../store/event-store';

export type ConductCommandContext = Readonly<{
  sessionId: string;
  branchId: string;
  expectedRevision: number;
  actor: ConductActor;
}>;
export type ConductCommandResult = Omit<ConductExecution, 'event'> & Readonly<{ event: ChainEvent; idempotent: boolean }>;
type StoredResult = { request: string; result: ConductCommandResult };

function cloneState(state: ConductState): ConductState {
  return { ...structuredClone(state), world: cloneWorld(state.world) };
}
function cloneResult(result: ConductCommandResult): ConductCommandResult {
  return { ...structuredClone(result), state: cloneState(result.state) };
}

export class ConductCommandService {
  private readonly states = new Map<string, ConductState>();
  private readonly commands = new Map<string, StoredResult>();
  private readonly events = new Map<string, ChainEvent[]>();
  private readonly store?: KshviEventStore;
  private readonly organizationId?: string;
  private readonly operations?: ConductOperations;

  constructor(options: { store?: KshviEventStore; organizationId?: string; operations?: ConductOperations } = {}) {
    this.store = options.store;
    this.organizationId = options.organizationId;
    this.operations = options.operations;
  }

  private key(sessionId: string, branchId: string): string { return `${sessionId}/${branchId}`; }
  state(sessionId: string, branchId: string): ConductState {
    const key = this.key(sessionId, branchId);
    const existing = this.states.get(key);
    if (existing) return cloneState(existing);
    const created = emptyConductState(sessionId);
    this.states.set(key, created);
    return cloneState(created);
  }

  async execute(context: ConductCommandContext, command: ConductCommand): Promise<ConductCommandResult> {
    const commandKey = `${this.key(context.sessionId, context.branchId)}/${command.commandId}`;
    const request = canonicalJson(command);
    const previous = this.commands.get(commandKey);
    if (previous) {
      if (previous.request !== request) throw new Error('Идемпотентный ключ уже использован с другой командой');
      return { ...cloneResult(previous.result), idempotent: true };
    }
    const current = this.state(context.sessionId, context.branchId);
    if (current.revision !== context.expectedRevision) throw new Error(`Устаревшая ревизия: ${context.expectedRevision}, актуальная ${current.revision}`);
    const execution = await executeConductCommand(current, command, context.actor, this.operations);
    const draft = execution.event;
    const normalizedWallClock = wallClockAt(draft.wallClockAt ?? command.at);
    const eventInput: ChainEventInput = {
      ...draft,
      organizationId: context.actor.organizationId,
      instanceId: context.sessionId,
      branchId: context.branchId,
      schemaVersion: draft.schemaVersion ?? 1,
      wallClockAt: normalizedWallClock,
      operationalAt: draft.operationalAt ?? operationalAt(normalizedWallClock, 'UTC'),
      actor: draft.actor ?? { id: context.actor.userId, kind: ['MODEL_RULE', 'AGENT', 'SYSTEM'].includes(context.actor.role) ? 'SYSTEM' : 'HUMAN' },
      causeIds: draft.causeIds ?? [command.commandId],
      versions: draft.versions ?? {},
      reducerVersion: draft.reducerVersion ?? 1,
    };
    let event: ChainEvent;
    if (this.store) {
      const persisted = await this.store.appendCommand({
        organizationId: this.organizationId ?? context.actor.organizationId,
        instanceId: context.sessionId,
        branchId: context.branchId,
        aggregateRevision: context.expectedRevision,
        idempotencyKey: command.commandId,
        eventId: eventInput.eventId,
        type: eventInput.type,
        payload: eventInput.payload,
        schemaVersion: eventInput.schemaVersion,
        wallClockAt: eventInput.wallClockAt,
        operationalAt: eventInput.operationalAt,
        actor: eventInput.actor,
        causeIds: eventInput.causeIds,
        versions: eventInput.versions,
        reducerVersion: eventInput.reducerVersion,
      });
      if (persisted.eventId !== execution.event.eventId) throw new Error('Хранилище изменило идентификатор официального события');
      event = { ...persisted.event, prevHash: persisted.prevHash, hash: persisted.hash };
    } else {
      event = appendToChain(this.events.get(this.key(context.sessionId, context.branchId)) ?? [], eventInput);
    }
    const key = this.key(context.sessionId, context.branchId);
    this.states.set(key, cloneState(execution.state));
    this.events.set(key, [...this.events.get(key) ?? [], event]);
    const result: ConductCommandResult = { ...execution, event, idempotent: false };
    this.commands.set(commandKey, { request, result: cloneResult(result) });
    return result;
  }

  async history(sessionId: string, branchId: string, organizationId = this.organizationId): Promise<ChainEvent[]> {
    if (this.store) {
      if (!organizationId) throw new Error('Для чтения журнала требуется organizationId');
      return this.store.listEvents(organizationId, sessionId, branchId);
    }
    return structuredClone(this.events.get(this.key(sessionId, branchId)) ?? []);
  }
}
