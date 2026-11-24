import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { appendToChain } from '../../../../packages/kshvi/src/events/hash-chain';
import type { ChainEvent, ChainEventInput } from '../../../../packages/kshvi/src/events/envelope';
import { reduceWorld } from '../../../../packages/kshvi/src/events/reducer';
import { operationalAt, wallClockAt } from '../../../../packages/kshvi/src/model/unknown';
import type { JsonValue } from '../../../../packages/kshvi/src/model/types';
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

  async executeDomain(
    context: ConductCommandContext,
    command: Readonly<{ commandId: string; type: string; payload: Readonly<Record<string, unknown>>; at: string }>,
  ): Promise<ConductCommandResult> {
    const commandKey = `${this.key(context.sessionId, context.branchId)}/${command.commandId}`;
    const request = canonicalJson(command);
    const previous = this.commands.get(commandKey);
    if (previous) {
      if (previous.request !== request) throw new Error('Идемпотентный ключ уже использован с другой командой');
      return { ...cloneResult(previous.result), idempotent: true };
    }
    const current = this.state(context.sessionId, context.branchId);
    if (current.revision !== context.expectedRevision) throw new Error(`Устаревшая ревизия: ${context.expectedRevision}, актуальная ${current.revision}`);
    const normalizedWallClock = wallClockAt(command.at);
    const causedBy = typeof command.payload.autonomyEventId === 'string' ? command.payload.autonomyEventId
      : typeof command.payload.eventId === 'string' ? command.payload.eventId : command.commandId;
    const payload = JSON.parse(JSON.stringify({
      ...command.payload, commandId: command.commandId, commandType: command.type, at: normalizedWallClock, causedBy,
    })) as JsonValue;
    const eventIdBytes = createHash('sha256').update(canonicalJson({
      organizationId: context.actor.organizationId, instanceId: context.sessionId, branchId: context.branchId, commandId: command.commandId,
    })).digest().subarray(0, 16);
    eventIdBytes[6] = (eventIdBytes[6]! & 0x0f) | 0x50;
    eventIdBytes[8] = (eventIdBytes[8]! & 0x3f) | 0x80;
    const eventIdHex = eventIdBytes.toString('hex');
    const eventId = `${eventIdHex.slice(0, 8)}-${eventIdHex.slice(8, 12)}-${eventIdHex.slice(12, 16)}-${eventIdHex.slice(16, 20)}-${eventIdHex.slice(20)}`;
    const eventInput: ChainEventInput = {
      eventId, organizationId: context.actor.organizationId, instanceId: context.sessionId, branchId: context.branchId,
      sequence: current.revision + 1, type: command.type, schemaVersion: 1, wallClockAt: normalizedWallClock,
      operationalAt: operationalAt(normalizedWallClock, 'UTC'),
      actor: { id: context.actor.userId, kind: ['MODEL_RULE', 'AGENT', 'SYSTEM'].includes(context.actor.role) ? 'SYSTEM' : 'HUMAN' },
      causeIds: [command.commandId], versions: {}, reducerVersion: 1, payload,
    };
    let event: ChainEvent;
    let idempotent = false;
    if (this.store) {
      const persisted = await this.store.appendCommand({
        organizationId: this.organizationId ?? context.actor.organizationId,
        instanceId: context.sessionId, branchId: context.branchId, aggregateRevision: context.expectedRevision,
        idempotencyKey: command.commandId, eventId: eventInput.eventId, type: eventInput.type, payload: eventInput.payload,
        schemaVersion: 1, wallClockAt: eventInput.wallClockAt, operationalAt: eventInput.operationalAt,
        actor: eventInput.actor, causeIds: eventInput.causeIds, versions: {}, reducerVersion: 1,
      });
      event = persisted.event;
      idempotent = persisted.idempotent;
    } else {
      event = appendToChain(this.events.get(this.key(context.sessionId, context.branchId)) ?? [], eventInput);
    }
    const world = current.world.appliedEventIds.includes(event.eventId) ? current.world
      : reduceWorld(current.world, event, { reducerVersion: 1, ...(this.store ? { registry: this.store.registry } : {}) });
    const state: ConductState = { ...current, world, revision: Math.max(current.revision, event.sequence) };
    const key = this.key(context.sessionId, context.branchId);
    this.states.set(key, cloneState(state));
    const localEvents = this.events.get(key) ?? [];
    this.events.set(key, localEvents.some(item => item.eventId === event.eventId) ? localEvents : [...localEvents, event]);
    const result: ConductCommandResult = { state, event, revision: state.revision, idempotent };
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
