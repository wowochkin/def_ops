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
