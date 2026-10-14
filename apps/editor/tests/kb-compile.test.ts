import { describe, expect, it } from 'vitest';
import type { CompiledEdits } from '@def-ops/knowledge';
import type { History, Scenario } from '@def-ops/sim';
import { applyCompiled, applyCompiledHistory, diffCompiled, migratePins, toCoreEdits } from '../src/sim/kb-compile';

const empty = (): CompiledEdits => ({ formations: {}, changes: [], checkpoints: [], positions: [], boundaries: [], crossings: [], events: [] });
const withF = (f: CompiledEdits['formations'], rest: Partial<CompiledEdits> = {}): CompiledEdits => ({ ...empty(), formations: f, ...rest });

describe('diffCompiled: перечень изменённых входов', () => {
  it('новое пополнение', () => {
    const b = withF({}, { changes: [{ at: '1945-04-18', formation: 'su_8ga', kind: 'reinforce', personnel: 5000 }] });
    expect(diffCompiled(empty(), b)).toEqual(['пополнение su_8ga 18.04 +5000']);
  });
  it('смена начальной численности', () => {
    expect(diffCompiled(withF({ su_61a: { personnel: 54000 } }), withF({ su_61a: { personnel: 52000 } }))).toEqual(['su_61a: людей 54000 → 52000']);
  });
  it('без изменений — пусто; порядок ключей не влияет', () => {
    const a = withF({ su_61a: { personnel: 1, tanks: 2 } }, { checkpoints: [{ at: '1945-04-20', formation: 'x', kind: 'strength', personnel: 9, tanks: 1 }] });
    const b = withF({ su_61a: { tanks: 2, personnel: 1 } }, { checkpoints: [{ tanks: 1, personnel: 9, kind: 'strength', formation: 'x', at: '1945-04-20' }] });
    expect(diffCompiled(a, b)).toEqual([]);
  });
  it('первая сборка (прежней нет) — всё как новое; снятое помечено', () => {
    const b = withF({ su_61a: { parent: 'su_1bf', enterAt: '1945-04-17T05:00' } }, {
      changes: [{ at: '1945-04-20T00:00', formation: 'su_3ga', kind: 'resubordinate', parent: 'su_1uf' }],
      checkpoints: [{ at: '1945-04-25', formation: 'su_8ga', kind: 'losses', from: '1945-04-16', personnel: 12000 }],
    });
    const d = diffCompiled(undefined, b);
    expect(d).toContain('su_61a: подчинение — → su_1bf');
    expect(d).toContain('su_61a: ввод — → 17.04 05:00');
    expect(d).toContain('переподчинение su_3ga 20.04 → su_1uf');
    expect(d).toContain('потери su_8ga 16.04–25.04: 12000');
    expect(diffCompiled(b, empty())).toContain('снято: переподчинение su_3ga 20.04 → su_1uf');
  });
  it('положения и события — числом', () => {
    const pos = { formation: 'a', time: '1945-04-17', at: [14, 52] as [number, number], approxKm: 5, reliability: 'B', source: 's' };
    expect(diffCompiled(empty(), withF({}, { positions: [pos], events: [{ kind: 'event', id: 'e', at: '1945-04-20', title: 'т' }] })))
      .toEqual(['положения: +1', 'события: +1']);
  });
});

const sc = (): Scenario => ({
  id: 'op', name: 'op', start: '1945-04-16T05:00', end: '1945-05-02T00:00', turnHours: 24, theatre: 't', rules: 'r', sides: [], orders: [],
  formations: [
    { id: 'su_61a', name: '61 А', side: 'su', echelon: 'army', parent: 'su_1bf', personnel: 54000, tanks: 10, guns: 100 },
    { id: 'su_1bf', name: '1 БФ', side: 'su', echelon: 'front' },
    { id: 'su_1uf', name: '1 УФ', side: 'su', echelon: 'front' },
  ],
} as unknown as Scenario);

describe('applyCompiled: наложение собранного на сценарий', () => {
  it('без собранного — сценарий как есть', () => {
    const s = sc();
    expect(applyCompiled(s, undefined)).toBe(s);
  });
  it('численность, подчинение, ввод; изменения по датам — только о формированиях сценария', () => {
    const c = withF({ su_61a: { personnel: 52000, parent: 'su_1uf', enterAt: '1945-04-17T05:00' }, su_12gsd: { personnel: 5000 } }, {
      changes: [
        { at: '1945-04-18', formation: 'su_61a', kind: 'reinforce', personnel: 5000 },
        { at: '1945-04-18', formation: 'su_12gsd', kind: 'reinforce', personnel: 500 },
        { at: '1945-04-19', formation: 'su_61a', kind: 'resubordinate', parent: 'nope' },
      ],
    });
    const r = applyCompiled(sc(), c);
    const f = r.formations.find((x) => x.id === 'su_61a')!;
    expect(f).toMatchObject({ personnel: 52000, tanks: 10, guns: 100, parent: 'su_1uf', enterAt: '1945-04-17T05:00' });
    expect(r.formations.some((x) => x.id === 'su_12gsd')).toBe(false);
    expect(r.changes).toEqual([{ at: '1945-04-18', formation: 'su_61a', kind: 'reinforce', personnel: 5000 }]);
  });
  it('свои изменения сценария сохраняются, одинаковые не дублируются', () => {
    const s = { ...sc(), changes: [{ at: '1945-04-18', formation: 'su_61a', kind: 'reinforce', personnel: 5000 }] } as Scenario;
    const r = applyCompiled(s, withF({}, { changes: [{ at: '1945-04-18', formation: 'su_61a', kind: 'reinforce', personnel: 5000 }] }));
    expect(r.changes).toHaveLength(1);
  });
});

describe('applyCompiledHistory: наложение на историю', () => {
  const h = (): History => ({
    scenario: 'op', frontline: [],
    positions: [{ formation: 'su_61a', time: '1945-04-17T12:00', at: [14, 52], approxKm: 15, place: 'A', reliability: 'B', source: 's' }],
    events: [{ id: 'seelow', title: 'Зееловские высоты', date: '1945-04-19', kind: 'reach', side: 'su', place: 'Seelow', radiusKm: 5 }],
  });
  it('контрольные точки, положения (без повторов и без координат — нет), дата события из базы', () => {
    const c = withF({}, {
      checkpoints: [{ at: '1945-04-20', formation: 'su_61a', kind: 'strength', personnel: 40000 }],
      positions: [
        { formation: 'su_61a', time: '1945-04-17T12:00', at: [14.1, 52], approxKm: 15, reliability: 'B', source: 'k' },
        { formation: 'su_61a', time: '1945-04-18', at: [14.2, 52], place: 'B', approxKm: 15, reliability: 'A', source: 'k' },
        { formation: 'su_61a', time: '1945-04-19', place: 'C', approxKm: 15, reliability: 'A', source: 'k' },
      ],
      events: [{ kind: 'event', id: 'seelow', at: '1945-04-18T20:00', title: 'Зееловские высоты' }, { kind: 'event', id: 'new', at: '1945-04-20', title: 'новое' }],
    });
    const r = applyCompiledHistory(h(), c);
    expect(r.checkpoints).toEqual([{ at: '1945-04-20', formation: 'su_61a', kind: 'strength', personnel: 40000 }]);
    expect(r.positions.map((p) => p.time)).toEqual(['1945-04-17T12:00', '1945-04-18']);
    expect(r.positions[1]).toMatchObject({ place: 'B', at: [14.2, 52] });
    expect(r.events!.map((e) => [e.id, e.date])).toEqual([['seelow', '1945-04-18']]);
  });
  it('положения — только формирований сценария, если он задан', () => {
    const c = withF({}, { positions: [{ formation: 'su_12gsd', time: '1945-04-18', at: [14, 52], approxKm: 5, reliability: 'B', source: 'k' }] });
    expect(applyCompiledHistory(h(), c, new Set(['su_61a'])).positions).toHaveLength(1);
    expect(applyCompiledHistory(h(), c).positions).toHaveLength(2);
  });
});

describe('toCoreEdits: поправки для ядра (дивизии)', () => {
  it('дивизии с parent → hq; изменения о дивизиях и штабах (у штаба — только переподчинение)', () => {
    const c = withF({ su_12gsd: { personnel: 5200, parent: 'su_61a', enterAt: '1945-04-17T05:00' }, su_61a: { personnel: 52000 } }, {
      changes: [
        { at: '1945-04-18', formation: 'su_12gsd', kind: 'reinforce', personnel: 500 },
        { at: '1945-04-19', formation: 'su_61a', kind: 'resubordinate', parent: 'su_1uf' },
        { at: '1945-04-19', formation: 'su_61a', kind: 'reinforce', personnel: 5000 },
        { at: '1945-04-19', formation: 'other', kind: 'reinforce', personnel: 1 },
      ],
    });
    expect(toCoreEdits(c, new Set(['su_12gsd']), new Set(['su_61a', 'su_1uf']))).toEqual({
      divisions: { su_12gsd: { personnel: 5200, hq: 'su_61a', enterAt: '1945-04-17T05:00' } },
      changes: [
        { at: '1945-04-18', formation: 'su_12gsd', kind: 'reinforce', personnel: 500 },
        { at: '1945-04-19', formation: 'su_61a', kind: 'resubordinate', parent: 'su_1uf' },
      ],
    });
  });
});

describe('migratePins: ручные правки и отклонённое — в закрепления', () => {
  const entries = [{ id: 'e1', category: 'formations', title: '61 А', facts: [
    { key: 'strength', value: '54 000 чел. на 16.04 (по документу)', claim: { kind: 'strength', subject: 'su_61a', at: '1945-04-16', personnel: 54000 } },
  ] }] as never;
  it('принятая цифра с узнаваемым фактом — закрепление, правка снята; без факта — остаётся; отклонённое — «ничего»', () => {
    const formations = {
      su_61a: { personnel: { value: 50000, was: 48000, source: 'боевая численность; 54 000 чел. на 16.04 (по документу)', at: 'x' } },
      su_47a: { tanks: { value: 10, was: 5, source: 'как-то; 10 танков', at: 'x' } },
    };
    const r = migratePins(entries, '1945-04-16T05:00', formations, ['toScenario|su_8ga|personnel', 'toKb|su_8ga|path'], {});
    expect(r.pins).toEqual({ 'strength|su_61a|1945-04-16T05:00': { entry: 'e1', index: 0 }, 'strength|su_8ga|1945-04-16T05:00': 'none' });
    expect(r.formations).toEqual({ su_47a: formations.su_47a });
    expect(r.kept).toEqual(['su_47a.tanks']);
  });
  it('существующее закрепление не перезаписывается', () => {
    const r = migratePins(entries, 'S', {}, ['toScenario|su_8ga|tanks'], { 'strength|su_8ga|S': { entry: 'z', index: 1 } });
    expect(r.pins).toEqual({});
  });
});
