import { describe, expect, it } from 'vitest';
import { appendToChain, canonicalJson, deriveRandom, eventHash, verifyEventChain } from '../src/events/index';

const fullFact = {
  eventId: '00000000-0000-4000-8000-000000000001',
  organizationId: 'org-1',
  instanceId: 'instance-1',
  branchId: 'branch-1',
  sequence: 1,
  type: 'resource.consumed.v1',
  schemaVersion: 1,
  wallClockAt: '2026-01-01T00:00:00.000Z',
  operationalAt: {
    normalizedAt: '2026-01-01T00:00:00.000Z',
    originalAt: '2026-01-01T03:00:00+03:00',
    zone: 'Europe/Moscow',
    offset: '+03:00',
  },
  actor: { id: 'system-1', kind: 'SYSTEM' },
  causeIds: ['cause-1'],
  versions: { model: { id: 'model-1', revision: 1, sha256: 'a'.repeat(64) } },
  reducerVersion: 1,
  payload: { resourceId: 'fuel', amount: 2, nested: { reason: 'test' } },
} as const;

describe('регрессии канонического журнала', () => {
  it('различает bigint, Date и sparse array от ранее коллидирующих JSON-значений', () => {
    expect(canonicalJson(1n)).not.toBe(canonicalJson('1n'));
    const at = new Date('2026-01-01T00:00:00.000Z');
    expect(canonicalJson(at)).not.toBe(canonicalJson(at.toISOString()));
    const sparse = new Array(1);
    expect(canonicalJson(sparse)).not.toBe(canonicalJson([null]));
  });

  it('не допускает подмену специального tagged-значения обычным объектом', () => {
    const encoded = canonicalJson(1n);
    const forged = JSON.parse(encoded) as unknown;
    expect(canonicalJson(forged)).not.toBe(encoded);
  });

  it('отклоняет не-bigint seed на JavaScript-границе', () => {
    expect(() => deriveRandom({
      seed: '7', exerciseId: 'e', branchId: 'b', purpose: 'movement', ordinal: 0, algorithmVersion: 1,
    } as never)).toThrow('seed');
  });

  it('требует полный DomainEvent до вычисления хеша', () => {
    expect(() => eventHash({
      eventId: fullFact.eventId, sequence: 1, type: fullFact.type, payload: fullFact.payload,
    } as never, null)).toThrow('конверт');
  });

  it('связывает хешем организацию, время, actor, причины, версии и reducer', () => {
    const baseline = eventHash(fullFact, null);
    for (const [key, value] of [
      ['organizationId', 'org-2'], ['instanceId', 'instance-2'], ['branchId', 'branch-2'],
      ['schemaVersion', 2], ['wallClockAt', '2026-01-01T00:00:01.000Z'],
      ['actor', { id: 'system-2', kind: 'SYSTEM' }], ['causeIds', ['cause-2']],
      ['versions', {}], ['reducerVersion', 2],
    ] as const) {
      expect(eventHash({ ...fullFact, [key]: value } as never, null), key).not.toBe(baseline);
    }
    expect(eventHash({
      ...fullFact,
      operationalAt: {
        normalizedAt: '2025-12-31T20:00:00.000Z', originalAt: '2025-12-31T20:00:00Z', zone: 'UTC', offset: '+00:00',
      },
    }, null)).not.toBe(baseline);
  });

  it('глубоко замораживает событие и отделяет payload от исходного объекта', () => {
    const input = structuredClone(fullFact) as unknown as { payload: { nested: { reason: string } } };
    const event = appendToChain([], input as never);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(() => { (event.payload as { nested: { reason: string } }).nested.reason = 'changed'; }).toThrow();
    input.payload.nested.reason = 'source-changed';
    expect((event.payload as { nested: { reason: string } }).nested.reason).toBe('test');
  });

  it('отклоняет повторные и самоссылочные causeIds и смену области внутри цепочки', () => {
    const first = appendToChain([], fullFact);
    expect(verifyEventChain([first])).toEqual([]);
    expect(verifyEventChain([{ ...first, causeIds: ['cause-1', 'cause-1'] }])).toContain(`CAUSE_IDS:${first.sequence}`);
    expect(verifyEventChain([{ ...first, causeIds: [first.eventId] }])).toContain(`CAUSE_IDS:${first.sequence}`);
    expect(verifyEventChain([{ ...first, organizationId: 'org-2' }])).toContain(`HASH:${first.sequence}`);
  });
});
