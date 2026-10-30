// «Итоги» голосом: results.show открывает вкладку и часть; разбор хода — «с позиции …», событие, связный текст.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandTerms, DebriefHq, KeyEvent, OperationSummary, TurnDebrief } from '@def-ops/sim';
import { act, parsePhrase, register } from '../src/voice/registry';
import { numberWords } from '../src/voice/speech';
import { setSectionSource } from '../src/voice/actions/command';
import { lossesSay, parseResults, releaseResults, resultsActions, type ResultsDeps } from '../src/voice/actions/results';
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

function mount(section: 'replay' | 'command', o: { debrief?: TurnDebrief | null; model?: boolean; baseErr?: string | null } = {}) {
  const log: ResultsPart[] = [];
  const hqs: (string | null)[] = [], opened: number[] = [];
  let hq: string | null = null, narrated = 0, retried = 0;
  const deps: ResultsDeps = {
    section: () => section, summary: () => null, side: () => 'su', setPart: (p) => { log.push(p); },
    debrief: () => (o.debrief === undefined ? null : o.debrief), terms: () => TERMS, hq: () => hq,
    setHq: (h) => { hq = h; hqs.push(h); }, openEvent: (n) => { opened.push(n); }, narrate: () => { narrated++; }, modelOn: () => !!o.model,
    baselineError: () => o.baseErr ?? null, retryBaseline: () => { retried++; },
  };
  const get = () => deps;
  const offs = resultsActions(get).map(register);
  return { log, hqs, opened, narrated: () => narrated, retried: () => retried, off: () => { offs.forEach((o) => o()); releaseResults(get); } };
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

const L = (personnel: number, tanks = 0, guns = 0) => ({ personnel, tanks, guns });
const row = (id: 'su' | 'de', total: number, last: number) => ({ id, name: id, side: id, echelon: 'side' as const, parent: null,
  total: L(total, 40, 25), captured: 0, reinforced: 0, byDay: [L(total - last), L(last)] });
const SUMMARY = (history: OperationSummary['history']['losses'] = []) => ({
  losses: { exact: true, upTo: 48, days: ['1945-04-16', '1945-04-17'], rows: [row('su', 12345, 3000), row('de', 8000, 2500)] },
  history: { losses: history },
}) as unknown as OperationSummary;

describe('фразы итогов и разбора', () => {
  let offs: (() => void)[] = [];
  afterEach(() => { offs.forEach((o) => o()); offs = []; });
  setSectionSource(() => 'replay');

  it('parse results phrases', () => {
    const m = mount('command', { debrief: DEBRIEF }); offs.push(m.off);
    expect(parseResults('итоги хода', 'replay')).toEqual({ id: 'results.show', params: { part: 'turn' } });
    expect(parseResults('сравни с историей', 'replay')).toEqual({ id: 'results.show', params: { part: 'compare' } });
    expect(parseResults('покажи потери', 'replay')).toEqual({ id: 'results.show', params: { part: 'losses' } });
    expect(parseResults('покажи итоги', 'replay')).toEqual({ id: 'results.show', params: {} });
    expect(parseResults('доложи потери', 'replay')).toEqual({ id: 'results.losses.read' });
    expect(parseResults('разбери ход с позиции восьмой гвардейской армии', 'replay')).toEqual({ id: 'command.debrief.as', params: { name: 'восьмой гвардейской армии' } });
    expect(parseResults('разбери ход с позиции Ставки', 'replay')).toEqual({ id: 'command.debrief.as', params: { name: 'Ставки' } });
    expect(parseResults('покажи событие два', 'replay')).toEqual({ id: 'command.debrief.event', params: { n: 2 } });
    expect(parseResults('покажи событие 2', 'replay')).toEqual({ id: 'command.debrief.event', params: { n: 2 } });
    expect(parseResults('расскажи ход связно', 'replay')).toEqual({ id: 'command.debrief.narrate' });
    expect(parseResults('покажи Зелов', 'replay')).toBeNull();
    expect(parseResults('итоги хода', 'maps')).toBeNull();
    // через общий разбор фраз: раньше «покажи …» — названий мест
    expect(parsePhrase('покажи событие два', 'replay')).toEqual({ id: 'command.debrief.event', params: { n: 2 } });
  });

  it('debrief.as by spoken name', async () => {
    const m = mount('command', { debrief: DEBRIEF }); offs.push(m.off);
    await act('command.debrief.as', { name: 'восьмой гвардейской армии' });
    expect(m.hqs).toEqual(['su_8gva']);
  });

  it('losses say', () => {
    const t = lossesSay(SUMMARY([{ scope: 'su', from: '1945-04-16', to: '1945-05-08', perDay: 15000, source: 'Кривошеев', reliability: 'A' }]), 'su');
    expect(t).not.toMatch(/\d/);
    expect(t).toContain(numberWords(12345));
    expect(t).toContain(numberWords(3000));
    expect(t).toContain(numberWords(8000));
    expect(t).toMatch(/за последние сутки/);
    expect(t).toMatch(new RegExp(`в истории[^.]*${numberWords(15000)}`));
    const bare = lossesSay(SUMMARY(), 'su');
    expect(bare).not.toMatch(/в истории/);
    // за немецкую сторону свои — немецкие
    expect(lossesSay(SUMMARY(), 'de').indexOf(numberWords(8000))).toBeLessThan(lossesSay(SUMMARY(), 'de').indexOf(numberWords(12345)));
  });

  it('losses read action', async () => {
    const m = mount('command'); offs.push(m.off);
    expect(String(await act('results.losses.read'))).toMatch(/итогов нет|потер/i);
  });
});

describe('results.baseline.retry', () => {
  let offs: (() => void)[] = [];
  afterEach(() => { offs.forEach((o) => o()); offs = []; });
  setSectionSource(() => 'replay');
  it('baseline error is retried: «повторить» — кнопкой и голосом; ошибки нет — недоступно', async () => {
    const ok = mount('command'); offs.push(ok.off);
    expect(String(await act('results.baseline.retry'))).toMatch(/повторять нечего/i);
    expect(ok.retried()).toBe(0);
    ok.off(); offs = [];
    const m = mount('command', { baseErr: 'ядро не ответило' }); offs.push(m.off);
    expect(parseResults('повтори расчет без вмешательства', 'replay')).toEqual({ id: 'results.baseline.retry' });
    const r = await act('results.baseline.retry');
    expect(m.retried()).toBe(1);
    expect(m.log).toEqual(['compare']);
    expect(String(r)).toMatch(/без вмешательства/);
  });
});
