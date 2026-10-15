import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { DEFAULT_GROUPS, TRIGGER_GROUPS, doctrineAfter, doctrineFor, doctrineKey, type DoctrineClaim, type DoctrineRule, type Entry, type Pins } from '../src';

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

  describe('момент хода: правила с датой позже хода не берутся', () => {
    const rule = (rs: DoctrineRule[], id: string) => rs.find((r) => r.claim.rule === id);
    it('приказ № 00566 (18.04.1945 22:00): на 16.04 06:00 — нет, на 19.04 — есть', () => {
      const at = (moment?: string) => doctrineFor(entries, {}, 'su', ['pressure'], '', { levels: ['front'], max: 40, chars: 100000, ...(moment ? { moment } : {}) }).rules;
      expect(rule(at('1945-04-16T06:00'), 'stop-pause-front-dir-00566')).toBeUndefined();
      expect(rule(at('1945-04-19T06:00'), 'stop-pause-front-dir-00566')).toBeDefined();
      expect(rule(at(), 'stop-pause-front-dir-00566')).toBeDefined();
      // дата в id правила (19-apr) и «19.04» без года — год по моменту
      expect(rule(at('1945-04-18T23:00'), 'regroup-1bf-turn-19-apr-dir-00567')).toBeUndefined();
      expect(rule(at('1945-04-19T06:00'), 'regroup-1bf-turn-19-apr-dir-00567')).toBeDefined();
    });

    it('даты: дд.мм.гггг, дд.мм (год по моменту ±1), ISO, «19 апреля», дд-mon; не даты — нет', () => {
      const f = (text: string, pages = '') => ({ key: 'principles', value: '', pages, claim: { ...flankC, condition: text, action: '' } });
      const m = '1945-04-16T06:00';
      expect(doctrineAfter(f('приказ от 18.04.1945'), m)).toBe(true);
      expect(doctrineAfter(f('приказ от 16.04.1945 22:00'), m)).toBe(false);
      expect(doctrineAfter(f('к 20.04 выйти'), m)).toBe(true);
      expect(doctrineAfter(f('с 27.02 по 15.04'), m)).toBe(false);
      expect(doctrineAfter(f('на 1945-04-17'), m)).toBe(true);
      expect(doctrineAfter(f('утром 17 апреля'), m)).toBe(true);
      expect(doctrineAfter(f('опыт 1944 г., 14.01.1944'), m)).toBe(false);
      expect(doctrineAfter(f('время 5.00, доля 0.33'), m)).toBe(false);
      expect(doctrineAfter(f('x', 'приказ от 10.05.1945'), m)).toBe(true);
      expect(doctrineAfter({ ...f('x'), claim: { ...flankC, rule: 'turn-19-apr', condition: '', action: '' } }, m)).toBe(true);
      expect(doctrineAfter(f('приказ от 18.04.1945')), 'без момента').toBe(false);
    });
  });
});
