import { expect, it } from 'vitest';
import { WorldFork } from '../src/ports/world-fork';

it('изолированный вариант не меняет официальный мир, outbox и RNG', () => {
  const official = {
    state: { forces: [{ id: 'own', readiness: 0.7 }], tick: 4 },
    rngCursor: 12,
    outbox: [] as string[],
    hash: 'official-before',
  };
  const fork = WorldFork.create(official, { id: 'fork-1', purpose: 'optionEvaluation' });
  const result = fork.evaluate('advance', state => {
    state.forces[0].readiness = 0.2;
    state.tick += 1;
    return { utility: 0.4 };
  });
  expect(result.utility).toBe(0.4);
  expect(fork.hash()).not.toBe(official.hash);
  expect(official.state).toEqual({ forces: [{ id: 'own', readiness: 0.7 }], tick: 4 });
  expect(official.rngCursor).toBe(12);
  expect(official.outbox).toEqual([]);
  expect(() => fork.publishOfficial({ type: 'event' })).toThrow('только для оценки');
  fork.destroy();
  expect(() => fork.evaluate('again', state => state)).toThrow('уничтожен');
});

it('не принимает форк с каналом записи в официальный мир', () => {
  expect(() => WorldFork.create({ state: {}, rngCursor: 0 }, {
    id: 'fork-2', purpose: 'optionEvaluation', officialWrite: () => undefined,
  })).toThrow('канал записи');
});
