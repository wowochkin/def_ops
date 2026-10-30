// «Итоги» голосом: results.show открывает вкладку и часть; разбор хода — «с позиции …», событие, связный текст.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandTerms, DebriefHq, KeyEvent, TurnDebrief } from '@def-ops/sim';
import { act, register } from '../src/voice/registry';
import { setSectionSource } from '../src/voice/actions/command';
import { releaseResults, resultsActions, type ResultsDeps } from '../src/voice/actions/results';
import type { ResultsPart } from '../src/results-view';

const TERMS = { top: 'Ставка', topGen: 'Ставки', topTo: 'в Ставку', group: 'фронт' } as CommandTerms;
const HQ = (id: string, name: string, parent: string | null, o: Partial<DebriefHq> = {}): DebriefHq => ({
  id, name, echelon: 'army', side: 'su', parent, alive: 2, state: 'line', points: [[14.5, 52.5]], center: [14.5, 52.5], task: null, goal: null, histKm: null, ...o,
});
const EV = (id: string): KeyEvent => ({ id, kind: 'breakthrough', side: 'su', tick: 20, title: `Прорыв ${id}`, text: 'т', at: [14.5, 52.5], from: null, to: null, place: 'у Зеелов',
  divisions: [], hqs: ['su_8gva'], km: 8, lost: 0, causes: [], weight: 3, seen: true });
const DEBRIEF: TurnDebrief = {
  from: 12, to: 24, time: '1945-04-17T05:00', side: 'su', events: [EV('a'), EV('b')], quiet: { maxAdvanceKm: 0, lost: 0 },
  hqs: { su_8gva: HQ('su_8gva', '8-я гвардейская армия', null), su_1gta: HQ('su_1gta', '1-я гвардейская танковая армия', null, { alive: 0, state: 'removed', points: [] }) },
};

function mount(section: 'replay' | 'command', o: { debrief?: TurnDebrief | null; model?: boolean } = {}) {
  const log: ResultsPart[] = [];
  const hqs: (string | null)[] = [], opened: number[] = [];
  let hq: string | null = null, narrated = 0;
  const deps: ResultsDeps = {
    section: () => section, summary: () => null, side: () => 'su', setPart: (p) => { log.push(p); },
    debrief: () => (o.debrief === undefined ? null : o.debrief), terms: () => TERMS, hq: () => hq,
    setHq: (h) => { hq = h; hqs.push(h); }, openEvent: (n) => { opened.push(n); }, narrate: () => { narrated++; }, modelOn: () => !!o.model,
  };
  const get = () => deps;
  const offs = resultsActions(get).map(register);
  return { log, hqs, opened, narrated: () => narrated, off: () => { offs.forEach((o) => o()); releaseResults(get); } };
}

describe('results.show', () => {
  let offs: (() => void)[] = [];
  afterEach(() => { offs.forEach((o) => o()); offs = []; });
  setSectionSource(() => 'replay');

  it('в игре открывает вкладку «Итоги» и часть compare', async () => {
    const m = mount('command'); offs.push(m.off);
    const r = await act('results.show', { part: 'compare' });
    expect(m.log).toEqual(['compare']);
    expect(String(r)).toMatch(/Итоги/);
  });

  it('в переигровке без разбора хода часть «Ход» недоступна', async () => {
    const m = mount('replay'); offs.push(m.off);
    const r = await act('results.show', { part: 'turn' });
    expect(String(r)).toMatch(/разбора хода нет/i);
    expect(m.log).toEqual([]);
    await act('results.show', { part: 'losses' });
    expect(m.log).toEqual(['losses']);
  });

  it('игра закрыта — действие остаётся у переигровки', async () => {
    const replay = mount('replay'); offs.push(replay.off);
    const game = mount('command');
    game.off();
    await act('results.show', {});
    expect(replay.log).toEqual(['losses']);
  });

  it('в переигровке с разбором — часть «Ход»', async () => {
    const m = mount('replay', { debrief: DEBRIEF }); offs.push(m.off);
    await act('results.show', { part: 'turn' });
    expect(m.log).toEqual(['turn']);
  });
});

describe('разбор хода голосом и кнопками', () => {
  let offs: (() => void)[] = [];
  afterEach(() => { offs.forEach((o) => o()); offs = []; });
  setSectionSource(() => 'replay');

  it('debrief.as removed hq', async () => {
    const m = mount('command', { debrief: DEBRIEF }); offs.push(m.off);
    const r = String(await act('command.debrief.as', { name: 'su_1gta' }));
    expect(r).toContain('снят с операции');
    expect(m.hqs).toEqual(['su_1gta']);
    expect(m.log).toEqual(['turn']);
    // по названию и верхняя инстанция
    await act('command.debrief.as', { name: '8-я гвардейская армия' });
    await act('command.debrief.as', { name: 'Ставки' });
    expect(m.hqs).toEqual(['su_1gta', 'su_8gva', null]);
    expect(String(await act('command.debrief.as', { name: 'нет такого' }))).toMatch(/такого штаба нет/i);
  });

  it('debrief.event out of range', async () => {
    const m = mount('command', { debrief: DEBRIEF }); offs.push(m.off);
    expect(String(await act('command.debrief.event', { n: 3 }))).toMatch(/событий за ход 2/i);
    expect(m.opened).toEqual([]);
    expect(String(await act('command.debrief.event', { n: 2 }))).toContain('Прорыв b');
    expect(m.opened).toEqual([2]);
  });

  it('debrief.event quiet turn', async () => {
    const m = mount('command', { debrief: { ...DEBRIEF, events: [] } }); offs.push(m.off);
    expect(String(await act('command.debrief.event', { n: 1 }))).toMatch(/ключевых событий нет/i);
  });

  it('narrate without model', async () => {
    const m = mount('command', { debrief: DEBRIEF }); offs.push(m.off);
    expect(String(await act('command.debrief.narrate'))).toMatch(/модель не на связи — разбор по данным хода/);
    expect(m.narrated()).toBe(0);
    const w = mount('command', { debrief: DEBRIEF, model: true }); offs.push(w.off);
    await act('command.debrief.narrate');
    expect(w.narrated()).toBe(1);
  });
});
