import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { doctrineValues, doctrineWords, type DoctrineClaim, type Entry } from '../src';

const root = new URL('../../../', import.meta.url);
const json = <T,>(p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const seed = json<{ entries: Entry[] }>('packages/knowledge/data/seed.json');
type Rule = { id: string; group: string; level: string; reliability?: string; values?: unknown };
const BOOKS = [
  { file: 'german-defence-doctrine-1945.json', side: 'de', n: 30 },
  { file: 'soviet-offensive-doctrine-1945.json', side: 'su', n: 79 },
  { file: 'soviet-offensive-doctrine-1945-tsamo.json', side: 'su', n: 35 },
] as const;
const rules = BOOKS.flatMap((b) => json<{ rules: Rule[] }>(`docs/sources/${b.file}`).rules.map((r) => ({ ...r, side: b.side })));
const facts = seed.entries.flatMap((e) => (e.facts ?? []).map((f) => ({ entry: e.id, fact: f })));
const doctrine = facts.filter((x) => x.fact.claim?.kind === 'doctrine');
const claimOf = (rule: string) => doctrine.find((x) => (x.fact.claim as DoctrineClaim).rule === rule)!.fact.claim as DoctrineClaim;

describe('доктрина в сиде', () => {
  it('фактов doctrine ровно 144 (30 + 79 + 35)', () => {
    for (const b of BOOKS) expect(json<{ rules: Rule[] }>(`docs/sources/${b.file}`).rules.length, b.file).toBe(b.n);
    expect(doctrine.length).toBe(144);
  });

  it('у каждого правила свода — ровно один факт principles в записи org:<side>-doctrine-<group>, надёжность — как у правила', () => {
    for (const r of rules) {
      const fs = doctrine.filter((x) => { const c = x.fact.claim as DoctrineClaim; return c.rule === r.id && c.side === r.side; });
      expect(fs.length, r.id).toBe(1);
      const [{ entry, fact }] = fs;
      const c = fact.claim as DoctrineClaim;
      expect(entry, r.id).toBe(`org:${r.side}-doctrine-${r.group}`);
      expect(fact.key, r.id).toBe('principles');
      expect(fact.reliability, r.id).toBe(r.reliability);
      expect(c.group, r.id).toBe(r.group);
      expect(c.level, r.id).toBe(r.level);
    }
  });

  it('в записях доктрины нет фактов principles без формальной части', () => {
    const bare = facts.filter((x) => /^org:(su|de)-doctrine-/.test(x.entry) && x.fact.key === 'principles' && !x.fact.claim);
    expect(bare.map((x) => `${x.entry}: ${x.fact.value.slice(0, 60)}`)).toEqual([]);
  });

  it('числа правила: пары — диапазоны, словари по армиям — плоскими ключами', () => {
    const c = claimOf('frontage-front-shock-sector');
    expect(c.level).toBe('front');
    expect(c.side).toBe('su');
    expect(c.values).toEqual({ breakthrough_total_km: [20, 35], share_of_front_pct: [5, 12], rifle_troops_pct: [50, 80], artillery_pct_max: 70, tanks_aviation_pct: [80, 95] });
    const b = claimOf('frontage-berlin-actual-sectors');
    expect(b.values!['breakthrough_km.su_47a']).toBe(4.3);
    expect(b.values!['guns_per_km.su_3ua']).toBe(266);
  });

  it('строки, null, логические, длинные списки, списки строк отброшены; все значения конечны', () => {
    expect(claimOf('gegenstoss-immediate-local').values?.time_limit_minutes).toBeUndefined();
    expect(claimOf('echelons-division-two-echelon-1944-45').values?.single_echelon_cases).toBeUndefined();
    expect(claimOf('depth-army-tasks-by-day-berlin-plan').values?.day_lines).toBeUndefined();
    expect(Object.keys(claimOf('stop-pause-front-dir-00566').values ?? {}).filter((k) => k.startsWith('coordination'))).toEqual([]);
    for (const x of doctrine) {
      for (const v of Object.values((x.fact.claim as DoctrineClaim).values ?? {})) {
        for (const n of [v].flat()) expect(Number.isFinite(n), (x.fact.claim as DoctrineClaim).rule).toBe(true);
      }
    }
  });
});

describe('doctrineValues', () => {
  it('число, пара, словарь чисел и пар; прочее — прочь; пусто — undefined', () => {
    expect(doctrineValues({ a: 1, b: [2, 3], c: 'x', d: null, e: true, f: [1, 2, 3], g: ['x', 'y'], h: { x: 1, y: 'z', z: [4, 5] }, i: NaN, j: { k: { l: 1 } } }))
      .toEqual({ a: 1, b: [2, 3], 'h.x': 1, 'h.z': [4, 5] });
    expect(doctrineValues({ s: 'текст' })).toBeUndefined();
    expect(doctrineValues(undefined)).toBeUndefined();
    expect(doctrineValues('строка')).toBeUndefined();
    expect(doctrineValues(5)).toEqual({ value: 5 });
    expect(doctrineValues([1, 2])).toEqual({ value: [1, 2] });
  });
});

describe('doctrineWords', () => {
  it('правило словами: сторона, ступень, группа, условие → действие, числа с десятичной запятой', () => {
    expect(doctrineWords({ kind: 'doctrine', side: 'de', level: 'corps', group: 'counterattack', rule: 'flank-attack-one-third', condition: 'Вклинение', action: 'Контратака резервом во фланг', values: { force_share: 0.33, km: [2, 4] } }))
      .toBe('Доктрина (нем., корпус, контратаки и контрудары): Вклинение → Контратака резервом во фланг; force_share 0,33, km 2–4');
    expect(doctrineWords({ kind: 'doctrine', side: 'su', level: 'front', group: 'tempo', rule: 'r', condition: 'Прорыв', action: 'Развивать' }))
      .toBe('Доктрина (сов., фронт, темп наступления): Прорыв → Развивать');
  });
});
