import { expect, it } from 'vitest';
import { ConductCommandService, type ConductCommandContext } from '../src/instances/conduct-command-service';
import { verifyEventChain } from '../../../packages/kshvi/src/events/hash-chain';
import type { CalculateOptions } from '../../../packages/kshvi/src/simulation/calculation';
import { withKshviDatabase } from './helpers/database';

const context: ConductCommandContext = {
  sessionId: 'session-real-1', branchId: 'main', expectedRevision: 0,
  actor: { userId: 'leader', role: 'LEADER', organizationId: 'org', sideId: 'blue', assignedNodeIds: ['node-1'] },
};
const decision = {
  id: 'decision-1', sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: 'Замысел',
  goals: [{ id: 'goal', rank: 1, title: 'Цель' }], tasks: [{ id: 'task', assigneeId: 'node-1', title: 'Задача' }], resources: [],
  deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
} as const;
const episode = {
  state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 },
  resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 14, supplied: 2 }, elapsedMinutes: 30,
  position: { remainingMeters: 100, travelledMeters: 0 }, uncertainty: {},
  effects: { taskProgressDelta: 20, positionAdvanceMeters: 50, stateChanges: {}, uncertaintyChanges: {} },
} as const;
const calculationInput: Omit<CalculateOptions, 'id' | 'mode'> = {
  reason: 'Расчёт приказа', createdAt: '2030-01-01T01:30:00Z', inputSnapshot: { revision: 1 }, inputs: { episode }, requiredInputs: [], units: {}, modelVersion: 'aggregate-v1', profileVersions: {},
  modelPassport: { purpose: 'Команды', limitations: ['Тест'], source: { kind: 'ASSUMPTION', note: 'Учебное допущение', applicability: 'Тест' }, knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1 },
  sideId: 'blue', nodeId: 'node-1',
};

it('Critical 1: исполняет только типизированные команды и создаёт причинно связанные события', async () => {
  const service = new ConductCommandService();
  const created = await service.execute(context, { type: 'decision.create', commandId: 'decision-create-1', at: '2030-01-01T01:00:00Z', decision });
  expect(created.revision).toBe(1);
  expect(created.event).toMatchObject({ type: 'decision.created.v1', eventId: created.event.eventId });
  expect(created.event.payload).toMatchObject({ commandId: 'decision-create-1', commandType: 'decision.create', causedBy: 'decision-1' });
  await expect(service.execute({ ...context, expectedRevision: 1 }, { type: 'order.reported.v1', commandId: 'forged', outcome: 'COMPLETED' } as never)).rejects.toThrow('команд');
  expect(await service.history(context.sessionId, context.branchId)).toHaveLength(1);
  expect(verifyEventChain(await service.history(context.sessionId, context.branchId))).toEqual([]);
});

it('Critical 1: идемпотентность и ревизия проверяются до доменного эффекта', async () => {
  const service = new ConductCommandService();
  const command = { type: 'decision.create' as const, commandId: 'decision-idempotent', at: '2030-01-01T01:00:00Z', decision };
  const first = await service.execute(context, command);
  const repeated = await service.execute(context, command);
  expect(repeated.event.eventId).toBe(first.event.eventId);
  expect(repeated.idempotent).toBe(true);
  expect(await service.history(context.sessionId, context.branchId)).toHaveLength(1);
  await expect(service.execute({ ...context, expectedRevision: 0 }, { ...command, commandId: 'stale' })).rejects.toThrow('ревизи');
});

it('Critical 1: calculation.apply сам порождает ресурсное событие и только затем становится APPLIED', async () => {
  const service = new ConductCommandService();
  await service.execute(context, { type: 'calculation.create', commandId: 'calc-create', at: '2030-01-01T01:30:00Z', calculationId: 'calc-1', mode: 'DETERMINISTIC', input: calculationInput });
  await service.execute({ ...context, expectedRevision: 1 }, { type: 'calculation.approve', commandId: 'calc-approve', at: '2030-01-01T01:31:00Z', calculationId: 'calc-1', reviewedParameters: {} });
  const applied = await service.execute({ ...context, expectedRevision: 2 }, { type: 'calculation.apply', commandId: 'calc-apply', at: '2030-01-01T01:32:00Z', calculationId: 'calc-1' });
  expect(applied.event.type).toBe('resource.consumed.v1');
  expect(applied.event.payload).toMatchObject({ resourceId: 'fuel', amount: 14, supplied: 2, causedBy: 'calc-1' });
  expect(applied.calculation?.state).toBe('APPLIED');
  expect(applied.calculation?.appliedEventIds).toEqual([applied.event.eventId]);
  expect(applied.state.world.resources.fuel).toEqual({ onHand: 0, consumed: 12, supplied: 2, deficit: 2 });
  const history = await service.history(context.sessionId, context.branchId);
  expect(history.map(event => event.type)).toEqual(['calculation.calculated.v1', 'calculation.approved.v1', 'resource.consumed.v1']);
});

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;
integration('Critical 1/2: PostgreSQL содержит именно событие официальной команды', async () => {
  await withKshviDatabase(async store => {
    const service = new ConductCommandService({ store, organizationId: 'org' });
    const result = await service.execute(context, { type: 'decision.create', commandId: 'pg-decision', at: '2030-01-01T01:00:00Z', decision });
    const journal = await service.history(context.sessionId, context.branchId);
    expect(journal).toHaveLength(1);
    expect(journal[0].eventId).toBe(result.event.eventId);
    expect(journal[0].payload).toMatchObject({ commandId: 'pg-decision', commandType: 'decision.create', causedBy: 'decision-1' });
    expect(await store.eventCount('org', context.sessionId)).toBe(1);
  });
});
