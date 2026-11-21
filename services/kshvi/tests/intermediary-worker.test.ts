import { expect, it } from 'vitest';
import type { AgentCommand, AgentCommandResponse } from '../../../packages/kshvi-agents/src/intermediary/act';
import type { AgentProjectionQuery, AgentWake, IntermediaryCycle } from '../../../packages/kshvi-agents/src/intermediary/cycle';
import { interceptAssignment, modifyAgentDecision, resumeAssignment } from '../../../packages/kshvi-agents/src/intermediary/escalate';
import { assignmentFixture, projectionFixture } from '../../../packages/kshvi-agents/tests/fixtures';
import { AgentCommandClient, AgentCommandTransportError, createFetchAgentCommandTransport, type AgentCommandTransport } from '../src/agents/agent-command-client';
import type { AgentRecoveryResult, PendingAgentCommand } from '../src/agents/agent-recovery';
import { IntermediaryWorker, type AgentWorkJournal } from '../src/agents/intermediary-worker';

class MemoryJournal implements AgentWorkJournal {
  readonly cycles = new Map<string, IntermediaryCycle>();
  readonly pending = new Map<string, PendingAgentCommand>();

  async isCycleProcessed(cycleId: string): Promise<boolean> {
    return this.cycles.has(cycleId);
  }

  async enqueueCommand(record: PendingAgentCommand): Promise<void> {
    if (!this.pending.has(record.command.commandId)) this.pending.set(record.command.commandId, record);
  }

  async completeCommand(commandId: string, _response: AgentCommandResponse): Promise<void> {
    this.pending.delete(commandId);
  }

  async pendingCommands(): Promise<readonly PendingAgentCommand[]> {
    return [...this.pending.values()];
  }

  async saveCycle(cycle: IntermediaryCycle): Promise<void> {
    this.cycles.set(cycle.cycleId, cycle);
  }
}

function commandFixture(): AgentCommand {
  return {
    commandId: 'agent-1:wake-1:action-1',
    idempotencyKey: 'agent:agent-1:wake-1:action-1',
    kind: 'issueDocument',
    assignmentId: 'agent-1',
    exerciseId: 'exercise-1',
    instanceId: 'higher',
    sectorId: 'north',
    actor: { kind: 'system', id: 'agent-1', assignmentId: 'agent-1' },
    expectedProjectionRevision: 7,
    issuedAt: '2030-01-01T00:10:00.000Z',
    payload: { actionId: 'action-1', reference: 'ref-1' },
  };
}

function backendFixture(initialProjection = projectionFixture(), failFirstDocument = false) {
  let projection = initialProjection;
  let documentFailureLeft = failFirstDocument ? 1 : 0;
  const effects = new Map<string, number>();
  const stored = new Map<string, AgentCommandResponse>();
  const attempts: AgentCommand[] = [];
  const queries: AgentProjectionQuery[] = [];
  const transport: AgentCommandTransport = async command => {
    attempts.push(command);
    const assignment = assignmentFixture();
    if (command.actor.kind !== 'system' || !assignment.allowedActions.includes(command.kind)) {
      throw new AgentCommandTransportError('Запрещено серверными полномочиями', { status: 403, code: 'OUTSIDE_DELEGATION', retryable: false });
    }
    const duplicate = stored.get(command.idempotencyKey);
    if (duplicate) return { ...duplicate, idempotent: true, effectApplied: false, status: 'DUPLICATE' };
    const effectCount = (effects.get(command.kind) ?? 0) + 1;
    effects.set(command.kind, effectCount);
    const response: AgentCommandResponse = {
      commandId: command.commandId,
      accepted: true,
      idempotent: false,
      effectApplied: true,
      status: 'APPLIED',
      eventId: `event-${command.commandId}`,
      serverRevision: projection.revision + effectCount,
    };
    stored.set(command.idempotencyKey, response);
    if (command.kind === 'issueDocument' && documentFailureLeft > 0) {
      documentFailureLeft -= 1;
      throw new AgentCommandTransportError('Ответ потерян после фиксации', { retryable: true });
    }
    return response;
  };
  return {
    effects,
    attempts,
    queries,
    transport,
    projectionSource: {
      loadProjection: async (query: AgentProjectionQuery) => {
        queries.push(query);
        return projection;
      },
    },
    setProjection(next: typeof projection) { projection = next; },
  };
}

const wake = (wakeId: string): AgentWake => ({ wakeId, kind: 'EVENT', requestedAt: '2030-01-01T00:10:00.000Z' });

it('AC-25: три инстанции DELEGATED ведутся без человека, запрет не действует, перехват и повтор не откатывают мир', async () => {
  const assignment = assignmentFixture({ mode: 'DELEGATED' });
  const journal = new MemoryJournal();
  const backend = backendFixture(projectionFixture(), true);
  const client = new AgentCommandClient({ transport: backend.transport, maxAttempts: 2, sleep: async () => {} });
  const worker = new IntermediaryWorker({ assignments: [assignment], projectionSource: backend.projectionSource, commandClient: client, journal });

  const first = await worker.runAssignment(assignment.assignmentId, wake('wake-1'));
  expect(first?.status).toBe('COMPLETED');
  expect(assignment.bindings.map(binding => binding.instanceId)).toEqual(['higher', 'neighbour', 'support']);
  expect(backend.effects.get('issueDocument')).toBe(1);
  expect(backend.attempts.filter(command => command.kind === 'issueDocument')).toHaveLength(2);
  expect(first?.trace.actor.kind).toBe('system');
  expect(backend.queries.every(query => query.actor.kind === 'system' && query.projection.projectionId === 'projection-agent-1')).toBe(true);

  const secondProjection = projectionFixture({
    revision: 8,
    sequence: 43,
    observations: [{ ...projectionFixture().observations[0], observationId: 'observation-2', summary: 'Новые сведения' }],
    requestedActions: [
      ...projectionFixture().requestedActions.filter(action => ['issueDocument', 'assignTask', 'requestCalculation', 'executeOrder'].includes(action.kind)),
      { actionId: 'forbidden', kind: 'changeScenarioConcept', instanceId: 'higher', sectorId: 'north', payload: {} },
    ],
  });
  backend.setProjection(secondProjection);
  const second = await worker.runAssignment(assignment.assignmentId, wake('wake-2'));
  expect(second?.status).toBe('ESCALATED');
  expect(second?.escalation?.reason).toBe('OUTSIDE_DELEGATION');
  expect(second?.appliedForbiddenEffects).toEqual([]);
  expect(backend.effects.has('changeScenarioConcept')).toBe(false);
  expect(second?.trace.options.length).toBeGreaterThanOrEqual(2);
  expect(second?.trace.responses.length).toBe(second?.trace.commands.length);
  expect(journal.cycles.get(second!.cycleId)?.trace.escalationReason).toBe('OUTSIDE_DELEGATION');

  const interception = interceptAssignment(second!.assignment, { kind: 'human', id: 'leader-1' }, second!.projection.sequence);
  const override = modifyAgentDecision(second!.trace, { kind: 'human', id: 'leader-1' }, {
    actionId: 'human-action', kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', payload: { reference: 'human-version' },
  });
  expect(interception.record).toEqual(expect.objectContaining({ worldSequence: 43, rollback: false, worldContinues: true }));
  expect(override.author).toEqual({ kind: 'human', id: 'leader-1' });
  worker.updateAssignment(resumeAssignment(interception.assignment, { kind: 'human', id: 'leader-1' }));

  backend.setProjection(projectionFixture({ revision: 9, sequence: 44, requestedActions: [override.action] }));
  const third = await worker.runAssignment(assignment.assignmentId, wake('wake-3'));
  expect(third?.status).toBe('COMPLETED');
  const effectsBeforeReplay = [...backend.effects.entries()];
  expect(await worker.runAssignment(assignment.assignmentId, wake('wake-3'))).toBeUndefined();
  expect([...backend.effects.entries()]).toEqual(effectsBeforeReplay);
});

it('сетевой повтор использует прежний ключ и не создаёт второй эффект', async () => {
  const command = commandFixture();
  const attempts: AgentCommand[] = [];
  let effects = 0;
  const client = new AgentCommandClient({
    maxAttempts: 2,
    sleep: async () => {},
    transport: async received => {
      attempts.push(received);
      if (attempts.length === 1) {
        effects += 1;
        throw new AgentCommandTransportError('Потерян ответ', { retryable: true });
      }
      return { commandId: received.commandId, accepted: true, idempotent: true, effectApplied: false, status: 'DUPLICATE' };
    },
  });

  const response = await client.submit(command);

  expect(response.status).toBe('DUPLICATE');
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  expect(attempts[1]?.idempotencyKey).toBe(command.idempotencyKey);
  expect(effects).toBe(1);
});

it('не повторяет серверный запрет и возвращает его в след', async () => {
  let attempts = 0;
  const client = new AgentCommandClient({
    maxAttempts: 4,
    sleep: async () => {},
    transport: async () => {
      attempts += 1;
      throw new AgentCommandTransportError('Запрещено', { status: 403, code: 'OUTSIDE_DELEGATION', retryable: false });
    },
  });

  const response = await client.submit(commandFixture());

  expect(attempts).toBe(1);
  expect(response).toEqual(expect.objectContaining({ accepted: false, effectApplied: false, status: 'REJECTED', reason: 'OUTSIDE_DELEGATION' }));
});

it('восстанавливает неподтверждённую команду после перезапуска без повторного эффекта', async () => {
  const assignment = assignmentFixture();
  const projection = projectionFixture({ requestedActions: [projectionFixture().requestedActions.find(action => action.kind === 'issueDocument')!] });
  const journal = new MemoryJournal();
  let offline = true;
  let effects = 0;
  const stored = new Map<string, AgentCommandResponse>();
  const keys: string[] = [];
  const transport: AgentCommandTransport = async command => {
    keys.push(command.idempotencyKey);
    const duplicate = stored.get(command.idempotencyKey);
    if (duplicate) return { ...duplicate, idempotent: true, effectApplied: false, status: 'DUPLICATE' };
    effects += 1;
    const response: AgentCommandResponse = { commandId: command.commandId, accepted: true, idempotent: false, effectApplied: true, status: 'APPLIED' };
    stored.set(command.idempotencyKey, response);
    if (offline) throw new AgentCommandTransportError('Сервис перезапущен', { retryable: true });
    return response;
  };
  const firstWorker = new IntermediaryWorker({
    assignments: [assignment],
    projectionSource: { loadProjection: async () => projection },
    commandClient: new AgentCommandClient({ transport, maxAttempts: 1, sleep: async () => {} }),
    journal,
  });
  const interrupted = await firstWorker.runAssignment(assignment.assignmentId, wake('recovery-wake'));
  expect(interrupted?.escalation?.reason).toBe('COMMAND_UNAVAILABLE');
  expect(journal.pending.size).toBe(1);
  expect(effects).toBe(1);

  offline = false;
  const secondWorker = new IntermediaryWorker({
    assignments: [assignment],
    projectionSource: { loadProjection: async () => projection },
    commandClient: new AgentCommandClient({ transport, maxAttempts: 1, sleep: async () => {} }),
    journal,
  });
  const recovered: AgentRecoveryResult = await secondWorker.recover();

  expect(recovered.recovered).toBe(1);
  expect(recovered.remaining).toBe(0);
  expect(journal.pending.size).toBe(0);
  expect(effects).toBe(1);
  expect(new Set(keys).size).toBe(1);
});

it('HTTP-транспорт передаёт системного актора, авторизацию и ключ идемпотентности', async () => {
  let requestUrl = '';
  let headers: Headers | undefined;
  const transport = createFetchAgentCommandTransport({
    baseUrl: 'https://kshvi.local',
    accessToken: 'service-secret',
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify({ commandId: commandFixture().commandId, accepted: true, idempotent: false, effectApplied: true, status: 'APPLIED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const response = await transport(commandFixture());

  expect(response.accepted).toBe(true);
  expect(requestUrl).toBe('https://kshvi.local/agents/commands');
  expect(headers?.get('authorization')).toBe('Bearer service-secret');
  expect(headers?.get('idempotency-key')).toBe(commandFixture().idempotencyKey);
  expect(headers?.get('x-agent-assignment')).toBe('agent-1');
});

it('серверный планировщик продолжает циклы без браузера и останавливается явно', async () => {
  const assignment = assignmentFixture({
    allowedActions: ['issueDocument'],
    schedule: { everyMs: 10, timeBudgetMs: 250 },
  });
  const projection = projectionFixture({ requestedActions: [projectionFixture().requestedActions.find(action => action.kind === 'issueDocument')!] });
  const journal = new MemoryJournal();
  const backend = backendFixture(projection);
  const worker = new IntermediaryWorker({
    assignments: [assignment],
    projectionSource: backend.projectionSource,
    commandClient: new AgentCommandClient({ transport: backend.transport }),
    journal,
  });

  await worker.start();
  await new Promise(resolve => setTimeout(resolve, 35));
  worker.stop();
  const countAfterStop = journal.cycles.size;
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(countAfterStop).toBeGreaterThanOrEqual(2);
  expect(journal.cycles.size).toBe(countAfterStop);
  expect(backend.effects.get('issueDocument')).toBe(countAfterStop);
});
