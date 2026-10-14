import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Claim, Entry } from '../src';

const root = new URL('../../../', import.meta.url);
const json = <T,>(p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;

const seed = json<{ entries: Entry[] }>('packages/knowledge/data/seed.json');
const claims: { entry: string; claim: Claim; reliability?: string }[] = seed.entries.flatMap((e) => (e.facts ?? []).filter((f) => f.claim).map((f) => ({ entry: e.id, claim: f.claim!, reliability: f.reliability })));
const of = <K extends Claim['kind']>(kind: K) => claims.filter((c) => c.claim.kind === kind) as { entry: string; claim: Extract<Claim, { kind: K }>; reliability?: string }[];

// формирования сценариев: общие (Берлин, Висла — Одер) и агентные (штабы и дивизии)
const scenarioIds = new Set<string>();
for (const s of ['berlin-1945', 'vistula-oder-1945']) {
  for (const f of json<{ formations: { id: string }[] }>(`packages/sim/data/scenarios/${s}.json`).formations) scenarioIds.add(f.id);
  const a = json<{ hqs: { id: string }[]; divisions: { id: string }[] }>(`packages/sim/data/scenarios/agents/${s}.json`);
  for (const f of [...a.hqs, ...a.divisions]) scenarioIds.add(f.id);
}

describe('формальные части фактов в сиде встроенных операций', () => {
  it('численность на начало Берлинской операции: фронт (A) и армия (B), с достоверностью источника', () => {
    const at = (id: string) => of('strength').filter((c) => c.claim.subject === id && c.claim.at === '1945-04-16');
    expect(at('su_1bf').some((c) => c.reliability === 'A' && c.claim.personnel === 908500)).toBe(true);
    expect(at('su_1pa').some((c) => c.reliability === 'B' && c.claim.personnel === 77293 && c.claim.tanks === 88 && c.claim.guns === 1326)).toBe(true);
  });

  it('численность на начало Висло-Одерской — на дату старта сценария', () => {
    const vo = of('strength').filter((c) => c.claim.subject === 'su_1uf_vo');
    expect(vo.some((c) => c.claim.at === '1945-01-12' && c.claim.personnel === 1100000)).toBe(true);
  });

  it('подчинённость: 12-я гв. сд — в 61-й армии, дата из строки реестра', () => {
    const p = of('parent').filter((c) => c.claim.subject === 'su_12gsd');
    expect(p.some((c) => c.claim.parent === 'su_61a' && c.claim.from === '1945-04-01')).toBe(true);
  });

  it('потери: по одной формальной части на запись own_losses с известным формированием и числом людей, кроме частичных («только …»)', () => {
    let total = 0, known = 0, partial = 0;
    const hasPeople = (v: Record<string, unknown>) => ['killed', 'wounded', 'missing', 'total'].some((k) => typeof v[k] === 'number');
    for (const f of ['berlin-1945-losses-daily.json', 'berlin-1945-losses-daily-tsamo.json']) {
      for (const r of json<{ records: { kind: string; formation: string | null; values: Record<string, unknown>; note?: string }[] }>(`docs/sources/${f}`).records) {
        if (r.kind !== 'own_losses') continue;
        total++;
        if (!r.formation || !scenarioIds.has(r.formation) || !hasPeople(r.values)) continue;
        if (/^\s*только(?!\p{L})/iu.test(r.note ?? '')) partial++; else known++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(of('losses').length).toBe(known);
    // частичные записи — 8 гв. А (только артиллерия, две записи) и 4 гв. ТА (только 62 гв. тбр, две записи)
    expect(partial).toBe(4);
    expect(of('losses').some((c) => c.claim.subject === 'su_8gva' && c.claim.from === '1945-04-16' && c.claim.to === '1945-04-27')).toBe(false);
    expect(of('losses').some((c) => c.claim.subject === 'su_4gta' && c.claim.to === '1945-04-17')).toBe(false);
    const l = of('losses').find((c) => c.claim.subject === 'su_8gva' && c.claim.from === '1945-04-11' && c.claim.to === '1945-05-01');
    expect(l?.claim.killed).toBe(4145);
    expect(l?.claim.wounded).toBe(18919);
    expect(l?.claim.missing).toBe(421);
    for (const { claim } of of('losses')) expect([claim.killed, claim.wounded, claim.missing, claim.total].some((x) => typeof x === 'number'), `${claim.subject} ${claim.from}`).toBe(true);
  });

  it('есть положения, линии, переправы и события', () => {
    expect(of('position').length).toBeGreaterThan(100);
    expect(of('boundary').some((c) => c.claim.between.join('|') === 'su_1bf|su_1uf')).toBe(true);
    expect(of('crossing').length).toBeGreaterThan(10);
    expect(of('event').some((c) => c.entry === 'op:berlin')).toBe(true);
    expect(of('event').some((c) => c.entry === 'op:vistula-oder')).toBe(true);
  });

  it('вход формирований (enter) в сид не выпускается: в источниках нет явных дат входа', () => {
    expect(of('enter').length).toBe(0);
  });

  it('у каждой формальной части формирования есть сценарная формация с этим id', () => {
    const bad = new Set<string>();
    for (const { claim } of claims) {
      const ids = claim.kind === 'boundary' ? claim.between : claim.kind === 'event' || claim.kind === 'crossing' ? [] : claim.kind === 'parent' ? [claim.subject, claim.parent] : [claim.subject];
      for (const id of ids) if (!scenarioIds.has(id)) bad.add(`${claim.kind}: ${id}`);
    }
    expect([...bad], `нет в сценариях:\n${[...bad].join('\n')}`).toEqual([]);
  });

  it('тексты существующих фактов сохранились (в том числе у фактов, получивших claim)', () => {
    const val = (id: string, key: string) => (seed.entries.find((e) => e.id === id)?.facts ?? []).filter((f) => f.key === key).map((f) => f.value);
    expect(val('f:su_1bf', 'commander')).toContain('Г. К. Жуков');
    expect(val('f:su_12gsd', 'echelon')).toContain('дивизия');
    // su_12gsd: в реестре корпус не в сценарии, а в факте — корпус; прежний факт остаётся, claim на армию — отдельный
    const f12 = (seed.entries.find((e) => e.id === 'f:su_12gsd')?.facts ?? []).filter((f) => f.key === 'parent');
    expect(f12.some((f) => !f.claim && /9-й гвардейский/.test(f.value))).toBe(true);
    // там, где вышестоящий в факте и в claim один, claim лежит на прежнем тексте (без пометки «с даты»)
    let attached = 0;
    for (const e of seed.entries) {
      for (const f of e.facts ?? []) if (f.claim?.kind === 'parent') {
        if (!/\(с \d\d\.\d\d\)$/.test(f.value)) attached++;
      }
    }
    expect(attached).toBeGreaterThan(100);
  });
});
