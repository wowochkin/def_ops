import { describe, expect, it } from 'vitest';
import { reduceWorld, replayWorld } from '../src/events/reducer';
import { ReducerRegistry } from '../src/events/reducer-registry';
import { emptyWorld, WORLD_COMPONENTS } from '../src/model/world';
import { validateAssumptionPassport } from '../src/model/assumptions';

const event = { type: 'resource.consumed.v1', eventId: 'e1', payload: { resourceId: 'fuel', amount: 2 }, causeIds: ['order-1'] } as const;

describe('версионный reducer', () => {
  it('применяет событие один раз и сохраняет причину', () => {
    const world = emptyWorld('scenario-1');
    const next = reduceWorld(world, event, { reducerVersion: 1 });
    // При пустом остатке весь запрос становится дефицитом, а не фактическим расходом.
    expect(next.resources.fuel.consumed).toBe(0);
    expect(next.resources.fuel.deficit).toBe(2);
    expect(next.eventCauses.e1).toEqual(['order-1']);
    expect(() => reduceWorld(next, event, { reducerVersion: 1 })).toThrow('уже применено');
  });

  it('не скрывает дефицит обрезанием остатка и учитывает поступление', () => {
    const world = emptyWorld('scenario-1');
    world.resources.fuel = { onHand: 3, consumed: 0, supplied: 0, deficit: 0 };
    const next = reduceWorld(world, { ...event, payload: { resourceId: 'fuel', amount: 5, supplied: 1 } }, { reducerVersion: 1 });
    expect(next.resources.fuel).toEqual({ onHand: 0, consumed: 4, supplied: 1, deficit: 1 });
  });

  it('применяет типизированные эффекты автономного события к компонентам мира', () => {
    const next = reduceWorld(emptyWorld('scenario-1'), {
      eventId: 'autonomy-1', type: 'autonomy.worldEffects.apply.v1',
      payload: {
        parameters: {},
        effects: [
          { type: 'resource.adjust', resourceId: 'fuel', ownerSideId: 'blue', unit: 'L', operation: 'RESTORE', amount: 100 },
          { type: 'resource.adjust', resourceId: 'fuel', ownerSideId: 'blue', unit: 'L', operation: 'CONSUME', amount: 10 },
          { type: 'force.state', forceId: 'force-1', status: 'DEGRADED' },
          { type: 'equipment.state', equipmentId: 'equipment-1', status: 'DAMAGED' },
          { type: 'terrain.state', areaId: 'area-1', status: 'RESTRICTED' },
          { type: 'communication.state', channelId: 'channel-1', status: 'UNAVAILABLE' },
        ],
      },
    }, { reducerVersion: 1 });
    expect(next.resources['blue/fuel']).toEqual({ onHand: 90, consumed: 10, supplied: 100, deficit: 0 });
    expect(next.state.Forces).toMatchObject({ 'force-1': { status: 'DEGRADED' } });
    expect(next.state.Equipment).toMatchObject({ 'equipment-1': { status: 'DAMAGED' } });
    expect(next.state.Terrain).toMatchObject({ 'area-1': { status: 'RESTRICTED' } });
    expect(next.state.Communications).toMatchObject({ 'channel-1': { status: 'UNAVAILABLE' } });
  });

  it('восстанавливает автономные наблюдения, документы, вводные и заявки по журналу', () => {
    const events = [
      { eventId: 'observation-1', type: 'observation.create.v1', payload: { observationId: 'observation-1', value: 'seen' } },
      { eventId: 'document-1', type: 'document.revision.create.v1', payload: { documentId: 'document-1', revision: 1, title: 'Донесение' } },
      { eventId: 'input-1', type: 'input.create.v1', payload: { inputId: 'input-1', visibility: 'PARTICIPANT' } },
      { eventId: 'approval-1', type: 'approval.request.create.v1', payload: { requestId: 'approval-1', reason: 'MANUAL_APPROVAL_PROFILE' } },
    ] as const;
    const next = replayWorld(emptyWorld('scenario-1'), events, { reducerVersion: 1 });
    expect(next.state.Observations).toMatchObject({ 'observation-1': { value: 'seen' } });
    expect(next.state.Documents).toMatchObject({ 'document-1': { revision: 1, title: 'Донесение' } });
    expect(next.state.ScenarioState).toMatchObject({
      Inputs: { 'input-1': { visibility: 'PARTICIPANT' } },
      ApprovalRequests: { 'approval-1': { reason: 'MANUAL_APPROVAL_PROFILE', status: 'PENDING' } },
    });
  });

  it('отклоняет неизвестное событие и отрицательный расход без изменения мира', () => {
    const world = emptyWorld('scenario-1');
    expect(() => reduceWorld(world, { ...event, type: 'unknown.v1' }, { reducerVersion: 1 })).toThrow('Неизвестный тип');
    expect(() => reduceWorld(world, { ...event, payload: { resourceId: 'fuel', amount: -1 } }, { reducerVersion: 1 })).toThrow('расход');
    expect(world.appliedEventIds).toEqual([]);
  });

  it('повторяет состояние по журналу и версии reducer', () => {
    const first = replayWorld(emptyWorld('scenario-1'), [event], { reducerVersion: 1 });
    const second = replayWorld(emptyWorld('scenario-1'), [event], { reducerVersion: 1 });
    expect(first).toEqual(second);
    expect(() => replayWorld(emptyWorld('scenario-1'), [event], { reducerVersion: 999 })).toThrow('версия');
  });

  it('реестр выбирает исходный reducer или явно отклоняет несовместимость', () => {
    const registry = new ReducerRegistry();
    registry.register(1, reduceWorld);
    expect(registry.get(1)).toBe(reduceWorld);
    expect(() => registry.get(2)).toThrow('Неподдерживаемая версия');
  });
});

describe('состояние и паспорт модели', () => {
  it('содержит все компоненты W_t', () => {
    expect(WORLD_COMPONENTS).toEqual([
      'Time', 'Forces', 'Equipment', 'Tasks', 'Resources', 'Supply', 'Readiness', 'MoralePsych',
      'Formation', 'Terrain', 'Weather', 'Observations', 'Communications', 'Documents', 'ScenarioState',
      'EventScheduler', 'AgentStates',
    ]);
    const world = emptyWorld('scenario-1');
    for (const component of WORLD_COMPONENTS) expect(world.state[component], component).toBeDefined();
  });

  it('не принимает численный норматив без источника и методического утверждения', () => {
    const passport = {
      purpose: 'Учебный расход ресурса',
      limitations: ['Только сценарный пример'],
      source: null,
      knownErrors: [],
      examples: [{ input: { amount: 2 }, expected: { consumed: 2 } }],
      approvedBy: 'methodist-1',
      version: 1,
    };
    expect(validateAssumptionPassport(passport)).toContain('Нужен источник или учебное допущение');
    expect(validateAssumptionPassport({ ...passport, source: { kind: 'ASSUMPTION', note: 'Учебное допущение', applicability: 'Учебный сценарий' } })).toEqual([]);
  });
});
