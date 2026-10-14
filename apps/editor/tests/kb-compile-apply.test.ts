import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { compileOperation, type Claim, type Entry } from '@def-ops/knowledge';
import { applyInfrastructure, Theatre, type Boundary, type InfraRecord, type Scenario, type TheatreData } from '@def-ops/sim';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945.json';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
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

  it('прежняя линия в правках операции и её перенесённый факт — одна линия', () => {
    const old: Boundary = { id: 'doc-x', kind: 'front', side: 'su', right: 'su_1uf', left: 'su_1bf', title: 'прежняя', from: '1945-04-17T00:00', line: [[14.2, 52.2], [14.3, 51.8]] };
    const withOld = { ...sc, boundaries: [...(sc.boundaries ?? []), old] };
    const out = applyCompiledBoundaries(withOld, compiled([line]), T);
    expect(out.boundaries!.filter((b) => b.from === '1945-04-17T00:00' && pair(b) === 'su_1bf|su_1uf')).toEqual([old]);
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
