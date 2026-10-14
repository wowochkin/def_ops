import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { compileOperation, type Claim, type Entry } from '@def-ops/knowledge';
import { applyInfrastructure, Theatre, type Boundary, type InfraRecord, type Scenario, type TheatreData } from '@def-ops/sim';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945.json';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
import citySc from '../../../packages/sim/data/scenarios/berlin-city-1945.json';
import cityFile from '../../../packages/sim/data/theatres/berlin-city-1945.json';
import { applyCompiledBoundaries, applyCompiledCrossings } from '../src/sim/kb-compile';

const sc = scenarioFile as unknown as Scenario;
const data = theatreFile as unknown as TheatreData;
const T = new Theatre(data);

/** Запись с фактами из вымышленного документа (проверено человеком). */
const entry = (claims: Claim[]): Entry => ({
  id: 'u:test', category: 'operations', title: 'тест', summary: '', status: 'checked', origin: 'user',
  facts: claims.map((claim) => ({ key: 'k', value: 'v', claim, source: 'doc:d1', reliability: 'B', check: { by: 'human', at: '', results: [] } })),
});
const line: Claim = { kind: 'boundary', between: ['su_1bf', 'su_1uf'], from: '1945-04-17', points: ['Beeskow', 'Cottbus'] };
const compiled = (claims: Claim[]) => compileOperation([entry(claims)], { id: 'berlin-1945', start: sc.start, end: sc.end, formations: sc.formations }, {}).edits;
const pair = (b: Boundary) => [b.right, b.left].sort().join('|');

describe('линии из базы — в сценарий', () => {
  it('принятая линия (пункты названиями) после сборки и наложения — в линиях сценария', () => {
    const out = applyCompiledBoundaries(sc, compiled([line]), T);
    const kb = out.boundaries!.filter((b) => b.from === '1945-04-17T00:00' && pair(b) === 'su_1bf|su_1uf');
    expect(kb).toHaveLength(1);
    expect(kb[0].line).toHaveLength(2);
    expect(kb[0].source).toBe('база знаний');
    expect(out.boundaries!.length).toBe((sc.boundaries ?? []).length + 1);
  });

  it('прежняя линия в правках операции и её перенесённый факт (те же пункты) — одна линия, прежняя', () => {
    const old: Boundary = { id: 'doc-x', kind: 'front', side: 'su', right: 'su_1uf', left: 'su_1bf', title: 'прежняя', from: '1945-04-17T00:00', places: ['Beeskow', 'Cottbus'], line: [[14.2, 52.2], [14.3, 51.8]] };
    const withOld = { ...sc, boundaries: [...(sc.boundaries ?? []), old] };
    const out = applyCompiledBoundaries(withOld, compiled([line]), T);
    expect(out.boundaries!.filter((b) => b.from === '1945-04-17T00:00' && pair(b) === 'su_1bf|su_1uf')).toEqual([old]);
  });

  it('линия базы той же пары и начала, но с другими пунктами, заменяет линию сценария (id и условие вступления — прежние)', () => {
    const base = sc.boundaries!.find((b) => b.id === '1bf-1uf-23apr')!;
    const fixed: Claim = { kind: 'boundary', between: ['su_1bf', 'su_1uf'], from: base.from, to: base.until!, points: ['Beeskow', 'Cottbus'], inclusive: 'su_1uf' };
    const out = applyCompiledBoundaries(sc, compiled([fixed]), T);
    const same = out.boundaries!.filter((b) => b.from === base.from && pair(b) === 'su_1bf|su_1uf');
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ id: base.id, trigger: base.trigger, source: 'база знаний', inclusive: 'su_1uf', until: base.until });
    expect(same[0].line).toHaveLength(2);
    expect(out.boundaries!.length).toBe(sc.boundaries!.length);
  });

  it('встроенная линия из сида (те же пункты, срок, «включительно» id) — сценарий не меняется', () => {
    const base = sc.boundaries!.find((b) => b.id === '1bf-1uf-15apr')!;
    const seedLine: Claim = { kind: 'boundary', between: ['su_1bf', 'su_1uf'], from: base.from, to: base.until!, points: base.places!, inclusive: 'su_1bf' };
    expect(applyCompiledBoundaries(sc, compiled([seedLine]), T)).toBe(sc);
  });

  it('«включительно» — id формирования сценария берётся как есть', () => {
    const out = applyCompiledBoundaries(sc, compiled([{ ...line, inclusive: 'su_1uf' } as Claim]), T);
    expect(out.boundaries!.find((b) => b.from === '1945-04-17T00:00' && pair(b) === 'su_1bf|su_1uf')?.inclusive).toBe('su_1uf');
  });

  it('пункты не найдены — линия пропускается', () => {
    const out = applyCompiledBoundaries(sc, compiled([{ ...line, points: ['Нигдебург', 'Невидаль'] }]), T);
    expect(out.boundaries).toEqual(sc.boundaries);
  });
});

describe('переправы из базы — в сведения об инфраструктуре', () => {
  const bridge: Claim = { kind: 'crossing', subject: 'мост через Одер у Франкфурт', from: '1945-04-18', state: 'destroyed' };

  it('«разрушена» с даты — мост театра разрушен с этой даты', () => {
    const recs = applyCompiledCrossings([], compiled([bridge]), T);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ state: 'destroyed', from: '1945-04-18' });
    expect(recs[0].bridge).toBe('br56');
    const b = applyInfrastructure(data, recs).bridges.find((x) => x.id === recs[0].bridge)!;
    expect(b.destroyedAt).toBe('1945-04-18T00:00');
  });

  it('не привязалась к театру — не применяется (не несвязанное сведение)', () => {
    expect(applyCompiledCrossings([], compiled([{ kind: 'crossing', subject: 'мост у Нигдебурга', from: '1945-04-18', state: 'destroyed' }]), T)).toEqual([]);
  });

  it('объект встроенной базы (subject — id объекта): мост театра по названиям записи obj:<id>, на той же реке', () => {
    const obj = (id: string, title: string, aliases: string[], claim: Claim): Entry => ({
      id: `obj:${id}`, category: 'terrain', group: 'rivers', title, aliases, summary: '', status: 'checked', origin: 'seed',
      facts: [{ key: 'crossings', value: 'v', claim, source: 'src:x', reliability: 'B' }],
    });
    const cityT = new Theatre(cityFile as unknown as TheatreData);
    const city = citySc as unknown as Scenario;
    const entries = [
      obj('br_spree_oberbaum', 'Обербаумбрюкке (Шпрее)', ['Oberbaumbrücke'], { kind: 'crossing', subject: 'br_spree_oberbaum', from: '1945-04-25', state: 'destroyed' }),
      // одноимённый мост на другой реке (Одер) — не берлинский Hansabrücke на Шпрее
      obj('br_oder_hansa', 'Ганза-мост через Одер в Штеттине (Одер)', ['Hansabrücke'], { kind: 'crossing', subject: 'br_oder_hansa', from: '1945-04-25', state: 'destroyed' }),
      // названия нет среди мостов театра — не применяется
      obj('br_nowhere', 'Безымянный мост (Шпрее)', ['Namenlose Brücke'], { kind: 'crossing', subject: 'br_nowhere', from: '1945-04-25', state: 'destroyed' }),
    ];
    const c = compileOperation(entries, { id: 'berlin-city-1945', start: city.start, end: city.end, formations: city.formations }, {}).edits;
    const recs = applyCompiledCrossings([], c, cityT);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ title: 'Обербаумбрюкке (Шпрее)', state: 'destroyed', bridge: 'br5' });
  });

  it('принятое раньше сведение о том же — не повторяется', () => {
    const old: InfraRecord = { id: 'old', kind: 'bridge', state: 'destroyed', title: 'Мост через Одер у Франкфурт', from: '1945-04-18', origin: 'document' };
    expect(applyCompiledCrossings([old], compiled([bridge]), T)).toEqual([old]);
  });
});

describe('getData: собранное из базы видят обе модели', () => {
  it('линии сценария и сведения об инфраструктуре операции — с фактами базы', async () => {
    globalThis.indexedDB = new IDBFactory();
    const { getData, saveEdits, getEdits } = await import('../src/sim/userdata');
    const c = compiled([line, { kind: 'crossing', subject: 'мост через Одер у Франкфурт', from: '1945-04-18', state: 'destroyed' }]);
    await saveEdits({ ...(await getEdits('berlin-1945')), kb: { compiled: c, provenance: [], conflicts: [], unmatched: [], at: '' } });
    const s = (await getData('scenarios', 'berlin-1945.json')) as Scenario;
    expect(s.boundaries!.some((b) => b.from === '1945-04-17T00:00' && b.source === 'база знаний')).toBe(true);
    const inf = (await getData('infrastructure', 'berlin-1945.json')) as { records: InfraRecord[] };
    expect(inf.records.map((r) => r.state)).toEqual(['destroyed']);
  });
});
