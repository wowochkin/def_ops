import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { DEFAULT_GROUPS, TRIGGER_GROUPS, doctrineFor, doctrineKey, type DoctrineClaim, type DoctrineRule, type Entry, type Pins } from '../src';

const entries = (seed as { entries: Entry[] }).entries;
const groups = (rs: { claim: DoctrineClaim }[]) => rs.map((r) => r.claim.group);

/** Запись пользователя с одним фактом доктрины. */
const userEntry = (id: string, claim: DoctrineClaim, reliability: 'A' | 'B' | 'C' = 'C'): Entry => ({
  id, category: 'organization', group: claim.side, title: id, summary: id, status: 'checked', origin: 'user',
  facts: [{ key: 'principles', value: claim.action, reliability, claim }],
});
const flankC: DoctrineClaim = { kind: 'doctrine', side: 'de', level: 'corps', group: 'counterattack', rule: 'flank-attack-one-third', condition: 'Контрудар по флангу вклинения.', action: 'Своё действие пользователя: удар силами не меньше полка.' };

describe('доктрина к обстановке', () => {
  it('группы триггеров и по умолчанию', () => {
    expect(TRIGGER_GROUPS.encircled).toEqual({ de: ['withdrawal', 'counterattack'], su: ['bypass'] });
    expect(TRIGGER_GROUPS.attack.su).toEqual(['echelons', 'commit', 'tempo', 'depth']);
    expect(DEFAULT_GROUPS).toEqual({ de: ['layout'], su: ['frontage', 'echelons'] });
  });

  it('немцы, вклинение: 1–8 правил контратак и резервов, не больше 4000 знаков', () => {
    const { rules, text } = doctrineFor(entries, {}, 'de', ['penetration'], '');
    expect(rules.length).toBeGreaterThanOrEqual(1);
    expect(rules.length).toBeLessThanOrEqual(8);
    for (const g of groups(rules)) expect(['counterattack', 'reserves']).toContain(g);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text.split('\n').every((l) => l.startsWith('- Доктрина (нем.'))).toBe(true);
    expect(rules[0].title).toBeTruthy();
    expect(rules.every((r) => r.claim.side === 'de')).toBe(true);
  });

  it('советские, наступление: первое правило — эшелоны', () => {
    const { rules } = doctrineFor(entries, {}, 'su', ['attack'], '');
    expect(rules[0].claim.group).toBe('echelons');
  });

  it('советские без триггеров, ступени фронт и армия', () => {
    const { rules } = doctrineFor(entries, {}, 'su', [], '', { levels: ['front', 'army'] });
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(['front', 'army']).toContain(r.claim.level);
      expect(['frontage', 'echelons']).toContain(r.claim.group);
    }
  });

  it('немцы, окружение и вклинение: сначала отход, потом контратаки', () => {
    const { rules } = doctrineFor(entries, {}, 'de', ['encircled', 'penetration'], '');
    const gs = groups(rules);
    expect(gs[0]).toBe('withdrawal');
    const firstCounter = gs.indexOf('counterattack');
    expect(firstCounter).toBeGreaterThan(0);
    expect(gs.slice(0, firstCounter).every((g) => g === 'withdrawal')).toBe(true);
    expect(gs.lastIndexOf('withdrawal')).toBeLessThan(firstCounter);
  });

  it('общие с запросом основы поднимают правило выше и допускают правила вне групп', () => {
    const plain = doctrineFor(entries, {}, 'de', ['penetration'], '');
    const q = doctrineFor(entries, {}, 'de', ['penetration'], 'плацдарм наковальня фланг вклинения');
    expect(q.rules[0].claim.rule).toBe('flank-attack-one-third');
    expect(plain.rules.length).toBeLessThanOrEqual(8);
  });

  describe('закрепления', () => {
    const withC = [...entries, userEntry('user:flank', flankC, 'C')];
    const find = (rs: DoctrineRule[]) => rs.filter((r) => r.claim.rule === 'flank-attack-one-third');
    const q = 'контрудар по флангу вклинения';

    it('без закрепления — встроенное правило (B), а не пользователя (C)', () => {
      const f = find(doctrineFor(withC, {}, 'de', ['penetration'], q).rules);
      expect(f.length).toBe(1);
      expect(f[0].entry).toBe('org:de-doctrine-counterattack');
      expect(f[0].reliability).toBe('B');
      expect(f[0].line).toMatch(/ \[B\]$/);
    });

    it('закрепление на факт C — в строке его действие', () => {
      const pins: Pins = { [doctrineKey('de', 'flank-attack-one-third')]: { entry: 'user:flank', index: 0 } };
      const r = doctrineFor(withC, pins, 'de', ['penetration'], q);
      const f = find(r.rules);
      expect(f.length).toBe(1);
      expect(f[0].entry).toBe('user:flank');
      expect(f[0].line).toContain('Своё действие пользователя');
      expect(r.text).toContain('Своё действие пользователя');
    });

    it("'none' — правила нет совсем, место не занято правилом C", () => {
      const pins: Pins = { [doctrineKey('de', 'flank-attack-one-third')]: 'none' };
      const r = doctrineFor(withC, pins, 'de', ['penetration'], q);
      expect(find(r.rules)).toEqual([]);
      expect(r.text).not.toContain('Своё действие пользователя');
      expect(r.text).not.toContain('наковальня');
    });

    it('закрепление на факт другой стороны не действует', () => {
      const su = userEntry('user:su-flank', { ...flankC, side: 'su', action: 'Советский вариант правила.' }, 'A');
      const pins: Pins = { [doctrineKey('de', 'flank-attack-one-third')]: { entry: 'user:su-flank', index: 0 } };
      const r = doctrineFor([...withC, su], pins, 'de', ['penetration'], q);
      const f = find(r.rules);
      expect(f.length).toBe(1);
      expect(f[0].entry).toBe('org:de-doctrine-counterattack');
      expect(r.text).not.toContain('Советский вариант');
    });
  });

  it('одно правило длиннее предела — обрезается до 4000 знаков с «…»', () => {
    const long = userEntry('user:long', { ...flankC, rule: 'long', action: 'а'.repeat(5000) }, 'A');
    const { rules, text } = doctrineFor([long], {}, 'de', ['penetration'], '');
    expect(rules.length).toBe(1);
    expect(text.length).toBe(4000);
    expect(text.endsWith('…')).toBe(true);
  });

  it('предел знаков: правила берутся, пока помещаются', () => {
    const { text } = doctrineFor(entries, {}, 'su', ['attack'], '', { chars: 600 });
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text.length).toBeGreaterThan(0);
  });
});
