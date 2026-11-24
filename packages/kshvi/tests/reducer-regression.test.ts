import { describe, expect, it } from 'vitest';
import { emptyWorld, reduceWorld, replayWorld, ReducerRegistry, type WorldState } from '../src/index';

const event = { eventId: 'e1', type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 2 }, causeIds: [] } as const;

describe('регрессии версионного состояния', () => {
  it('сохраняет накопленный неудовлетворённый расход', () => {
    let world = emptyWorld('scenario-1');
    world = reduceWorld(world, event, { reducerVersion: 1 });
    world = reduceWorld(world, { ...event, eventId: 'e2', payload: { resourceId: 'fuel', amount: 3 } }, { reducerVersion: 1 });
    expect(world.resources.fuel.deficit).toBe(5);
  });

  it('имеет одно каноническое представление ресурсов и read-only alias', () => {
    const world = emptyWorld('scenario-1');
    const replacement: WorldState['state']['Resources'] = { fuel: { onHand: 9, consumed: 0, supplied: 0, deficit: 0 } };
    world.state.Resources = replacement;
    expect(world.resources).toBe(replacement);
    expect(Object.getOwnPropertyDescriptor(world, 'resources')?.set).toBeUndefined();
    expect(Object.keys(world)).not.toContain('resources');
  });

  it('replay выбирает reducerVersion каждого события через ReducerRegistry', () => {
    const registry = new ReducerRegistry();
    registry.register(1, reduceWorld);
    registry.register(2, (world, current, profile) => reduceWorld(world, {
      ...current,
      payload: { ...(current.payload as { resourceId: string; amount: number }), amount: (current.payload as { amount: number }).amount * 2 },
    }, { ...profile, reducerVersion: 1 }));
    const world = emptyWorld('scenario-1');
    world.resources.fuel = { onHand: 10, consumed: 0, supplied: 0, deficit: 0 };
    const restored = replayWorld(world, [{ ...event, reducerVersion: 2 }], { reducerVersion: 1, registry });
    expect(restored.resources.fuel.consumed).toBe(4);
  });
});
