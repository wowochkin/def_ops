import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileOperation, type CompileInput, type Claim, type Entry } from '../src';

const root = new URL('../../../', import.meta.url);
const json = <T,>(p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;

/** Запись базы с фактами: [формальная часть, надёжность]. */
const entry = (id: string, facts: [Claim, ('A' | 'B' | 'C')?][], updatedAt = '2026-01-01'): Entry => ({
  id, category: 'formations', title: id, summary: '', status: 'checked', updatedAt,
  facts: facts.map(([claim, reliability], i) => ({ key: `k${i}`, value: 'v', source: `src:${id}`, reliability, claim })),
});

const op: CompileInput = {
  id: 't', start: '1945-04-16T05:00', end: '1945-04-20T05:00',
  formations: [
    { id: 'su_f', name: 'Фронт', side: 'su', echelon: 'front', parent: null },
    { id: 'su_g', name: 'Фронт 2', side: 'su', echelon: 'front', parent: null },
    { id: 'su_x', name: 'Армия', side: 'su', echelon: 'army', parent: 'su_f', personnel: 5000, tanks: 10, guns: 100 },
  ],
};

describe('сборщик «база → модель»', () => {
  it('начальная численность — из надёжного факта; расхождение A/B видно', () => {
    const r = compileOperation([
      entry('a', [[{ kind: 'strength', subject: 'su_x', at: '1945-04-16', personnel: 6000 }, 'A']]),
      entry('b', [[{ kind: 'strength', subject: 'su_x', at: '1945-04-15', personnel: 7000 }, 'B']]),
    ], op, {});
    expect(r.edits.formations.su_x.personnel).toBe(6000);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].chosen?.entry).toBe('a');
    const p = r.provenance.find((x) => x.input === 'su_x.personnel');
    expect(p?.fact?.entry).toBe('a');
    expect(p?.reliability).toBe('A');
  });

  it('подчинённость: до начала — в формированиях, после — переподчинение', () => {
    const r = compileOperation([entry('p', [
      [{ kind: 'parent', subject: 'su_x', from: '1945-04-01', parent: 'su_f' }, 'B'],
      [{ kind: 'parent', subject: 'su_x', from: '1945-04-18', parent: 'su_g' }, 'B'],
    ])], op, {});
    expect(r.edits.formations.su_x.parent).toBe('su_f');
    expect(r.edits.changes[0]).toEqual({ at: '1945-04-18', formation: 'su_x', kind: 'resubordinate', parent: 'su_g' });
    expect(r.provenance.find((x) => x.input === 'change:0')?.fact?.index).toBe(1);
  });

  it('старший вне операции — не поправка; переподчинение ему — не изменение', () => {
    const r = compileOperation([entry('p', [
      [{ kind: 'parent', subject: 'su_x', from: '1945-04-01', parent: 'su_stavka' }, 'B'],
      [{ kind: 'parent', subject: 'su_g', from: '1945-04-18', parent: 'su_stavka' }, 'B'],
    ])], op, {});
    expect(r.edits.formations.su_x?.parent).toBeUndefined();
    expect(r.provenance.find((x) => x.input === 'su_x.parent')?.fact?.entry).toBe('p');
    expect(r.edits.changes).toEqual([]);
  });

  it('пополнение — изменение; численность после начала — контрольная точка', () => {
    const r = compileOperation([entry('s', [
      [{ kind: 'reinforce', subject: 'su_x', at: '1945-04-18', personnel: 1000, tanks: 20 }, 'B'],
      [{ kind: 'strength', subject: 'su_x', at: '1945-04-19', personnel: 4200 }, 'B'],
    ])], op, {});
    expect(r.edits.changes).toEqual([{ at: '1945-04-18', formation: 'su_x', kind: 'reinforce', personnel: 1000, tanks: 20 }]);
    expect(r.edits.checkpoints).toEqual([{ at: '1945-04-19', formation: 'su_x', kind: 'strength', personnel: 4200 }]);
    expect(r.edits.formations.su_x?.personnel).toBeUndefined();
  });

  it('потери — накопительно с начала', () => {
    const r = compileOperation([entry('l', [
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-16', to: '1945-04-16', killed: 100, wounded: 300 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-17', to: '1945-04-17', killed: 50, wounded: 150 }, 'B'],
    ])], op, {});
    const l = r.edits.checkpoints.filter((c) => c.kind === 'losses');
    expect(l).toEqual([
      { at: '1945-04-16', formation: 'su_x', kind: 'losses', from: '1945-04-16', personnel: 400 },
      { at: '1945-04-17', formation: 'su_x', kind: 'losses', from: '1945-04-16', personnel: 600 },
    ]);
    // точка на 17.04 держится на обоих фактах
    expect(r.provenance.filter((p) => p.input === 'checkpoint:1').length).toBe(2);
  });

  it('потери: общее число без разбивки; итог с началом до операции не даёт точки', () => {
    const r = compileOperation([entry('l', [
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-16', to: '1945-04-16', killed: 100, wounded: 300 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-17', to: '1945-04-17', total: 200 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-11', to: '1945-04-19', total: 1500 }, 'B'],
    ])], op, {});
    const l = r.edits.checkpoints.filter((c) => c.kind === 'losses');
    expect(l.map((c) => [c.at, c.kind === 'losses' && c.from, c.kind === 'losses' && c.personnel])).toEqual([
      ['1945-04-16', '1945-04-16', 400], ['1945-04-17', '1945-04-16', 600],
    ]);
  });

  it('потери: на один конец — цепочка по дням важнее итога с началом до операции', () => {
    const r = compileOperation([entry('l', [
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-16', to: '1945-04-16', killed: 100, wounded: 300 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-17', to: '1945-04-17', total: 200 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-11', to: '1945-04-17', total: 1500 }, 'B'],
    ])], op, {});
    const l = r.edits.checkpoints.filter((c) => c.kind === 'losses');
    expect(l.map((c) => [c.at, c.kind === 'losses' && c.from, c.kind === 'losses' && c.personnel])).toEqual([
      ['1945-04-16', '1945-04-16', 400], ['1945-04-17', '1945-04-16', 600],
    ]);
  });

  it('потери: две цепочки на один конец с разной суммой — подробнее выбрана, расхождение видно', () => {
    const r = compileOperation([entry('l', [
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-16', to: '1945-04-16', killed: 100, wounded: 300 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-17', to: '1945-04-17', total: 200 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-16', to: '1945-04-17', total: 1600 }, 'B'],
    ])], op, {});
    const l = r.edits.checkpoints.filter((c) => c.kind === 'losses');
    expect(l.map((c) => [c.at, c.kind === 'losses' && c.from, c.kind === 'losses' && c.personnel])).toEqual([
      ['1945-04-16', '1945-04-16', 400], ['1945-04-17', '1945-04-16', 600],
    ]);
    const c = r.conflicts.find((x) => x.key === 'losses|su_x|1945-04-17');
    expect(c?.chosen?.index).toBe(1);
    expect(c?.candidates.map((x) => x.index).sort()).toEqual([1, 2]);
  });

  it('факт о неизвестном формировании — в unmatched, без исключения', () => {
    let r!: ReturnType<typeof compileOperation>;
    expect(() => { r = compileOperation([entry('n', [[{ kind: 'strength', subject: 'su_nope', at: '1945-04-16', personnel: 1 }, 'A']])], op, {}); }).not.toThrow();
    expect(r.unmatched.length).toBe(1);
    expect(r.edits.formations).toEqual({});
  });

  it('пустая база: поправок нет, всё — допущения', () => {
    const r = compileOperation([], op, {});
    expect(r.edits.formations).toEqual({});
    expect(r.edits.changes).toEqual([]);
    expect(r.edits.checkpoints).toEqual([]);
    expect(r.provenance.length).toBeGreaterThan(0);
    expect(r.provenance.every((p) => p.reliability === 'assumption' && p.fact === null)).toBe(true);
    expect(r.provenance.some((p) => p.input === 'su_x.personnel')).toBe(true);
    expect(r.provenance.some((p) => p.input === 'su_x.parent')).toBe(true);
  });

  it('закрепление выбирает факт и снимает правило', () => {
    const r = compileOperation([
      entry('a', [[{ kind: 'strength', subject: 'su_x', at: '1945-04-16', personnel: 6000 }, 'A']]),
      entry('b', [[{ kind: 'strength', subject: 'su_x', at: '1945-04-16', personnel: 7000 }, 'B']]),
    ], op, { [`strength|su_x|${op.start}`]: { entry: 'b', index: 0 } });
    expect(r.edits.formations.su_x.personnel).toBe(7000);
  });

  it('закреплённый факт удалён — в расхождениях с отметкой, выбор по правилу', () => {
    const r = compileOperation([
      entry('a', [[{ kind: 'strength', subject: 'su_x', at: '1945-04-16', personnel: 6000 }, 'A']]),
    ], op, { [`strength|su_x|${op.start}`]: { entry: 'b', index: 0 } });
    expect(r.edits.formations.su_x.personnel).toBe(6000);
    const c = r.conflicts.find((x) => x.key === `strength|su_x|${op.start}`);
    expect(c?.pin).toBe('missing');
    expect(c?.chosen?.entry).toBe('a');
  });

  it("закрепление «не брать» — в расхождениях; вход — допущение, исключённое закреплением", () => {
    const r = compileOperation([
      entry('a', [[{ kind: 'strength', subject: 'su_x', at: '1945-04-16', personnel: 6000 }, 'A']]),
    ], op, { [`strength|su_x|${op.start}`]: 'none' });
    expect(r.edits.formations.su_x?.personnel).toBeUndefined();
    const c = r.conflicts.find((x) => x.key === `strength|su_x|${op.start}`);
    expect(c?.pin).toBe('none');
    expect(c?.candidates.map((x) => x.entry)).toEqual(['a']);
    const p = r.provenance.find((x) => x.input === 'su_x.personnel');
    expect(p?.reliability).toBe('assumption');
    expect(p?.excluded).toBe(true);
    // без фактов «не брать» — тоже видно (снять), но вход не исключён: фактов нет
    const r2 = compileOperation([], op, { [`strength|su_x|${op.start}`]: 'none' });
    expect(r2.conflicts.find((x) => x.key === `strength|su_x|${op.start}`)?.pin).toBe('none');
    expect(r2.provenance.find((x) => x.input === 'su_x.personnel')?.excluded).toBeUndefined();
  });

  it('подчинённость: поздняя смена B важнее раннего A — не переподчинение по ходу', () => {
    const r = compileOperation([entry('p', [
      [{ kind: 'parent', subject: 'su_x', from: '1945-04-01', parent: 'su_f' }, 'A'],
      [{ kind: 'parent', subject: 'su_x', from: '1945-04-16', parent: 'su_g' }, 'B'],
    ])], op, {});
    expect(r.edits.formations.su_x.parent).toBe('su_g');
    expect(r.edits.changes).toEqual([]);
  });

  it('потери: цепочки с разницей меньше порога людей (500) — не расхождение', () => {
    const r = compileOperation([entry('l', [
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-16', to: '1945-04-16', total: 1000 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-17', to: '1945-04-17', total: 2000 }, 'B'],
      [{ kind: 'losses', subject: 'su_x', from: '1945-04-16', to: '1945-04-17', total: 3400 }, 'B'],
    ])], op, {});
    expect(r.conflicts.find((x) => x.key === 'losses|su_x|1945-04-17')).toBeUndefined();
  });

  it('линии, положения, события — из выбранных фактов; дивизии агентного сценария — свои', () => {
    const r = compileOperation([entry('o', [
      [{ kind: 'boundary', between: ['su_f', 'su_g'], from: '1945-04-15', points: ['А', 'Б'] }, 'A'],
      [{ kind: 'position', subject: 'su_d', at: '1945-04-17', place: 'Зелов', lngLat: [14.4, 52.5] }, 'B'],
      [{ kind: 'event', id: 'ev1', at: '1945-04-17', title: 'Событие' }, 'A'],
      [{ kind: 'strength', subject: 'su_d', at: '1945-04-16', personnel: 5100 }, 'B'],
    ])], { ...op, divisions: [{ id: 'su_d', name: 'Дивизия', side: 'su', echelon: 'division', parent: 'su_x', personnel: 4900 }] }, {});
    expect(r.edits.boundaries).toHaveLength(1);
    expect(r.edits.positions).toEqual([{ formation: 'su_d', time: '1945-04-17', at: [14.4, 52.5], place: 'Зелов', approxKm: 5, reliability: 'B', source: 'src:o' }]);
    expect(r.edits.events).toHaveLength(1);
    expect(r.edits.formations.su_d.personnel).toBe(5100);
    expect(r.unmatched).toEqual([]);
    for (const k of ['boundary:0', 'position:0', 'event:0']) expect(r.provenance.find((p) => p.input === k)?.fact?.entry).toBe('o');
  });
});

/** Операции каталога (и исходный сценарий Берлина): сценарий нынешней модели, агентный (дивизии), известные расхождения. */
/** Сравнений численности не меньше compared; потери в базе есть — losses; положений из базы не меньше positions. */
const NORDLAND = 'в базе — подчинённость III тк СС по ведомости (berlin-1945-divisions); в сценарии — оперативная, у корпуса на Зееловском направлении; база важнее (решение)';
const OPS: { scenario: string; agents: string; allowed: Record<string, string>; compared: number; losses: boolean; positions: number }[] = [
  { scenario: 'berlin-1945', agents: 'berlin-1945', compared: 6, losses: true, positions: 50, allowed: {
    'de_lvi.personnel': 'ru-wiki: «вместе с тыловыми частями до 50 000» (оценка без ссылки); сценарий делит 112 143 чел. 9 А по дивизиям корпусов — 27 186',
  } },
  { scenario: 'berlin-1945-tasks', agents: 'berlin-1945', compared: 6, losses: true, positions: 50, allowed: {
    'de_lvi.personnel': 'ru-wiki: «вместе с тыловыми частями до 50 000» (оценка без ссылки); сценарий делит 112 143 чел. 9 А по дивизиям корпусов — 27 186',
    'de_nordland.parent': NORDLAND,
    'de_nederland.parent': NORDLAND,
  } },
  // Висла — Одер: фактов численности в базе мало (две цифры), потерь по формированиям нет
  { scenario: 'vistula-oder-1945', agents: 'vistula-oder-1945', compared: 1, losses: false, positions: 10, allowed: {
    'de_festung_posen_vo.personnel': 'сценарий: «свыше 30 000» с ополчением; в базе 17 500 — база важнее (решение)',
  } },
];

for (const o of OPS) describe(`воспроизводимость: сид → начальное состояние, ${o.scenario}`, () => {
  const seed = json<{ entries: Entry[] }>('packages/knowledge/data/seed.json');
  const sc = json<{ id: string; start: string; end: string; formations: (CompileInput['formations'][number] & { note?: string })[] }>(`packages/sim/data/scenarios/${o.scenario}.json`);
  const ag = json<{ divisions: { id: string; name: string; side: string; hq: string; personnel?: number; tanks?: number; guns?: number; enterAt?: string }[] }>(`packages/sim/data/scenarios/agents/${o.agents}.json`);
  const input: CompileInput = {
    id: sc.id, start: sc.start, end: sc.end,
    formations: sc.formations.map(({ id, name, side, echelon, parent, personnel, tanks, guns, enterAt }) => ({ id, name, side, echelon, parent, personnel, tanks, guns, enterAt })),
    divisions: ag.divisions.map((d) => ({ id: d.id, name: d.name, side: d.side, echelon: 'division', parent: d.hq, personnel: d.personnel, tanks: d.tanks, guns: d.guns, enterAt: d.enterAt ?? null })),
  };
  const r = compileOperation(seed.entries, input, {});

  /**
   * Известные расхождения источника и сценария (не ошибки формальных частей): id.поле → почему.
   * Сценарий делит численность армии между корпусами по числу дивизий, а у факта — своя оценка.
   */
  const ALLOWED = o.allowed;
  it('численность, танки, орудия на начало совпадают со сценарием там, где у формирования есть факт', () => {
    const bad: string[] = [];
    let compared = 0;
    for (const f of sc.formations) {
      const e = r.edits.formations[f.id];
      if (!e) continue;
      for (const k of ['personnel', 'tanks', 'guns'] as const) {
        if (e[k] == null || f[k] == null) continue;
        compared++;
        if (e[k] !== f[k] && !ALLOWED[`${f.id}.${k}`]) bad.push(`${f.id}.${k}: база ${e[k]}, сценарий ${f[k]}`);
      }
    }
    for (const key of Object.keys(ALLOWED).filter((x) => !x.endsWith('.parent'))) {
      const [id, k] = key.split('.') as [string, 'personnel' | 'tanks' | 'guns'];
      const f = sc.formations.find((x) => x.id === id)!;
      if (r.edits.formations[id]?.[k] === f[k]) bad.push(`${key}: в списке известных расхождений, но совпадает — убрать из списка`);
    }
    if (bad.length) console.log('расхождения сида и сценария:\n' + bad.join('\n'));
    expect(compared).toBeGreaterThanOrEqual(o.compared);
    expect(bad).toEqual([]);
  });

  it('подчинённость армий и корпусов из базы совпадает со сценарием', () => {
    const bad: string[] = [];
    for (const f of sc.formations) {
      const p = r.edits.formations[f.id]?.parent;
      if (p !== undefined && p !== (f.parent ?? undefined) && !ALLOWED[`${f.id}.parent`]) bad.push(`${f.id}: база ${p}, сценарий ${f.parent}`);
    }
    if (bad.length) console.log('подчинённость:\n' + bad.join('\n'));
    expect(bad).toEqual([]);
  });

  if (o.scenario === 'berlin-1945-tasks') it('перечень состава без даты не перебивает подчинённость, датированную раньше начала', () => {
    // «Боевой состав» на 1.04 (A): 3 гв. тк — 2 БФ, 8 гв. тк — 2 уд. А; перечень Le Tissier без даты — 1 БФ
    expect(r.edits.formations.su_3gtk?.parent).toBe('su_2bf');
    expect(r.edits.formations.su_8gtk?.parent).toBe('su_2ua');
  });

  it('по каждому формированию сценария есть provenance численности и подчинённости', () => {
    for (const f of [...input.formations, ...input.divisions!]) {
      expect(r.provenance.some((p) => p.input === `${f.id}.personnel`), f.id).toBe(true);
      expect(r.provenance.some((p) => p.input === `${f.id}.parent`), f.id).toBe(true);
    }
    expect(r.edits.checkpoints.some((c) => c.kind === 'losses')).toBe(o.losses);
    expect(r.edits.positions.length).toBeGreaterThan(o.positions);
  });
});
