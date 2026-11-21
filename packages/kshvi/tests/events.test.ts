import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendToChain, canonicalJson, deriveRandom, eventHash, verifyEventChain } from '../src/events/index';

const key = { seed: 7n, exerciseId: 'e', branchId: 'b', purpose: 'movement', ordinal: 4, algorithmVersion: 1 } as const;

describe('канонический JSON', () => {
  it('канонизирует ключи и отделяет потоки случайности', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(deriveRandom(key)).toEqual(deriveRandom(key));
    expect(deriveRandom(key)).not.toEqual(deriveRandom({ ...key, purpose: 'contact' }));
    expect(deriveRandom(key).value).toBeGreaterThanOrEqual(0);
    expect(deriveRandom(key).value).toBeLessThan(1);
  });

  it('не зависит от порядка вложенных ключей и сохраняет bigint', () => {
    expect(canonicalJson({ z: { d: 4, c: 3n }, a: [2, 1] })).toBe('{"a":[2,1],"z":{"c":"3n","d":4}}');
    expect(() => canonicalJson({ value: Number.NaN })).toThrow('конечным числом');
    expect(() => canonicalJson(undefined)).toThrow('undefined');
  });
});

describe('хеш-цепочка журнала', () => {
  const first = { eventId: '00000000-0000-4000-8000-000000000001', sequence: 1, type: 'instance.paused.v1', payload: { reason: 'проверка' } } as const;

  it('создаёт воспроизводимый хеш неизменяемого факта', () => {
    expect(eventHash(first, null)).toBe(eventHash({ ...first }, null));
    expect(eventHash(first, null)).toMatch(/^[0-9a-f]{64}$/);
    expect(eventHash(first, null)).not.toBe(eventHash({ ...first, payload: { reason: 'другая' } }, null));
  });

  it('обнаруживает повреждение предыдущего хеша и разрыв последовательности', () => {
    const one = appendToChain([], first);
    const two = appendToChain([one], { ...first, eventId: '00000000-0000-4000-8000-000000000002', sequence: 2 });
    expect(verifyEventChain([one, two])).toEqual([]);
    expect(verifyEventChain([one, { ...two, prevHash: '0'.repeat(64) }])).toContain('PREV_HASH:2');
    expect(verifyEventChain([one, { ...two, sequence: 3 }])).toContain('SEQUENCE:3');
  });
});

describe('чистота официального выбора', () => {
  it('не использует Math.random или текущее системное время в ядре событий', () => {
    const root = new URL('../src/events/', import.meta.url).pathname;
    for (const file of readdirSync(root).filter(name => name.endsWith('.ts'))) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, file).not.toContain('Math.random');
      expect(source, file).not.toContain('Date.now');
    }
  });
});
