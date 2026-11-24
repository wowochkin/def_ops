import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendToChain, canonicalJson, deriveRandom, eventHash, verifyEventChain } from '../src/events/index';

const key = { seed: 7n, exerciseId: 'e', branchId: 'b', purpose: 'movement', ordinal: 4, algorithmVersion: 1 } as const;
const first = {
  eventId: '00000000-0000-4000-8000-000000000001',
  organizationId: 'org-1', instanceId: 'instance-1', branchId: 'branch-1',
  sequence: 1, type: 'instance.paused.v1', schemaVersion: 1,
  wallClockAt: '2026-01-01T00:00:00.000Z',
  operationalAt: { normalizedAt: '2026-01-01T00:00:00.000Z', originalAt: '2026-01-01T00:00:00Z', zone: 'UTC', offset: '+00:00' },
  actor: { id: 'system-1', kind: 'SYSTEM' }, causeIds: [], versions: {}, reducerVersion: 1,
  payload: { reason: 'проверка' },
} as const;

describe('канонический JSON', () => {
  it('канонизирует ключи и отделяет потоки случайности', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(deriveRandom(key)).toEqual(deriveRandom(key));
    expect(deriveRandom(key)).not.toEqual(deriveRandom({ ...key, purpose: 'contact' }));
    expect(deriveRandom(key).value).toBeGreaterThanOrEqual(0);
    expect(deriveRandom(key).value).toBeLessThan(1);
  });

  it('не зависит от порядка вложенных ключей и сохраняет тип bigint', () => {
    expect(canonicalJson({ z: { d: 4, c: 3n }, a: [2, 1] })).toBe('{"a":[2,1],"z":{"c":{"$kshvi_canonical_type":"bigint","value":"3"},"d":4}}');
    expect(() => canonicalJson({ value: Number.NaN })).toThrow('конечным числом');
    expect(() => canonicalJson(undefined)).toThrow('undefined');
  });
});

describe('хеш-цепочка журнала', () => {
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
  it('исключает скрытую энтропию и сетевые вызовы во всех модулях официального RNG', () => {
    const roots = [
      new URL('../src/events/', import.meta.url).pathname,
      new URL('../../kshvi-events/src/', import.meta.url).pathname,
      new URL('../../../services/kshvi/src/runtime/', import.meta.url).pathname,
    ];
    const files = [new URL('../src/simulation/stochastic.ts', import.meta.url).pathname];
    for (const root of roots) {
      const walk = (directory: string) => {
        for (const name of readdirSync(directory)) {
          const path = join(directory, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (path.endsWith('.ts')) files.push(path);
        }
      };
      walk(root);
    }
    const forbidden = [/Math\s*\.\s*random/, /Date\s*\.\s*now/, /new\s+Date\s*\(\s*\)/, /(?<![\w.])Date\s*\(\s*\)/, /randomUUID|randomBytes|getRandomValues/];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) expect(source, `${file}: ${pattern}`).not.toMatch(pattern);
      // production-config — только явный I/O-адаптер workers, вычисления и replay его не импортируют.
      if (!file.endsWith('/runtime/production-config.ts')) expect(source, `${file}: сетевой вызов в вычислительном модуле`).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
