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

  it('потери: по одной формальной части на запись own_losses с известным формированием', () => {
    let total = 0, known = 0;
    for (const f of ['berlin-1945-losses-daily.json', 'berlin-1945-losses-daily-tsamo.json']) {
      for (const r of json<{ records: { kind: string; formation: string | null }[] }>(`docs/sources/${f}`).records) {
        if (r.kind !== 'own_losses') continue;
        total++;
        if (r.formation && scenarioIds.has(r.formation)) known++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(of('losses').length).toBe(known);
    const l = of('losses').find((c) => c.claim.subject === 'su_8gva' && c.claim.from === '1945-04-11' && c.claim.to === '1945-05-01');
    expect(l?.claim.killed).toBe(4145);
    expect(l?.claim.wounded).toBe(18919);
    expect(l?.claim.missing).toBe(421);
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

  it('текст фактов не меняется: у фактов с формальной частью есть значение', () => {
    for (const e of seed.entries) for (const f of e.facts ?? []) if (f.claim) expect(f.value.length, `${e.id}/${f.key}`).toBeGreaterThan(0);
  });
});
