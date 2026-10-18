// «Переигровка» и «Командование» голосом: доклады без модели, разбор фраз, действия с поддельным состоянием
// (раздел в фоне, игры нет, расчёта нет), «покажи Зелов», «доложи о восьмой гвардейской», вход в командование.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { places as simPlaces, Theatre, type IntelReport, type Scenario, type TheatreData, type UnitReport } from '@def-ops/sim';
import type { TurnView } from '../src/sim/game-protocol';
import { act, register, setSpeaker, type Action } from '../src/voice/registry';
import { Dispatcher } from '../src/voice/dispatch';
import {
  commandActions, findLayer, NO_GAME, NOT_IN_REPLAY, parseCommand, parseDay, replayActions, resolveTarget, setSectionSource, takeoverParse,
  type CommandDeps, type ReplayDeps,
} from '../src/voice/actions/command';
import { intelReport, journalDayText, situationReport, unitReport } from '../src/voice/report';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945-tasks.json';

const T = new Theatre(theatreFile as unknown as TheatreData);
const P = simPlaces(T).map((p) => ({ id: p.id, title: p.title, at: p.at }));
const F = (scenarioFile as unknown as Scenario).formations;
const zelov = P.find((p) => p.title.startsWith('Зелов ('))!;

const unitRep = (f: { id: string; name: string; parent: string | null }, over: Partial<UnitReport> = {}): UnitReport => ({
  id: f.id, name: f.name, parent: f.parent, echelon: 'army', status: 'active', at: [14.4, 52.55], place: 'у Зелова', posture: 'наступает',
  task: 'наступать', target: 'на Берлин', orderSource: 'script', personnel: 75_400, tanks: 120, guns: 900, strength: 0.86, ammo: 1.4, fuel: 0.9,
  fatigue: 0.3, cutOff: false, movedKm: 6, combats: [], pending: [], ...over,
} as UnitReport);
const armies = F.filter((f) => f.side === 'su' && / армия/.test(f.name) && f.parent);
const own = armies.map((f, i) => unitRep(f as never, i === 2 ? { cutOff: true } : f.id === 'su_8gva'
  ? { at: [14.45, 52.6], combats: [{ against: ['56-й танковый корпус'], role: 'attack', outcome: 'прорыв', ratio: 3.1, advanceKm: 6.4, lossPct: 4, at: '1945-04-17T05:00' }] } : {}));
const intel: IntelReport[] = F.filter((f) => f.side === 'de').slice(0, 4).map((f, i) => ({
  id: f.id, name: f.name, at: [14.2 + i * 0.1, 52.5], place: 'у Мюнхеберга', posture: 'обороняется', estimate: 'до 20 тыс. чел.', fresh: i === 0,
  nearest: { name: '8-я гвардейская армия', km: 4 + i },
}));
const EVENTS = [
  '8-я гвардейская армия прорвала оборону у Зелова и продвинулась на 6 км.',
  '1-я гвардейская танковая армия вышла к Мюнхебергу.',
  '5-я ударная армия ведёт бой за Штраусберг.',
  'Противник отвёл 9-ю армию за Шпрее.',
  'Переправа у Кюстрина действует с 06:00.',
];
const view = (over: Partial<TurnView> = {}): TurnView => ({
  scenario: 'berlin-1945-tasks', scenarioName: 'Берлинская операция', rules: 'x', seed: 1, start: '1945-04-16T05:00', end: '1945-05-08T05:00',
  takeover: '1945-04-16T05:00', time: '1945-04-18T05:00', turnHours: 24, turn: 3, over: false, outcome: null,
  victory: 'Знамя Победы над рейхстагом', deadline: '1945-05-08T05:00', strength: 0.91, strengthBelow: 0.5,
  human: { id: 'su', name: 'СССР' }, ai: { id: 'de', name: 'Германия' }, terms: {} as TurnView['terms'],
  groups: F.filter((f) => f.side === 'su' && !f.parent).map((f) => ({ id: f.id, name: f.name })), own, intel, events: EVENTS, places: P,
  delays: {}, detectKm: 15,
  goals: [{ title: 'Зееловские высоты: взяты', historical: '1945-04-17T12:00', simulated: '1945-04-17T18:00', days: 0, at: null, place: null }],
  journal: [
    { time: '1945-04-16T05:00', orders: ['8-я гвардейская армия: наступать на Зелов'], actions: [], events: ['Начато наступление.'] },
    { time: '1945-04-17T05:00', orders: [], actions: ['Переправа у Кюстрина: наводится'], events: EVENTS.slice(0, 2) },
  ],
  doc: {} as TurnView['doc'], bases: [], priority: [], priorityMax: 2, supplyHours: {}, rangeHours: 24, bridges: [], parks: 2, lastDecision: null,
  sectors: [], boundaries: [], groupOf: {}, armies: [], reserveGroups: [], ...over,
} as TurnView);

const sentences = (t: string) => t.match(/[^.!?…]+[.!?…]+["»]?/g)?.length ?? 0;

describe('доклады без модели', () => {
  it('обстановка — 5–7 фраз, числа словами; остальное — «подробнее»', () => {
    const r = situationReport(view());
    expect(r.text).not.toMatch(/\d/);
    expect(sentences(r.text)).toBeGreaterThanOrEqual(5);
    expect(sentences(r.text)).toBeLessThanOrEqual(7);
    expect(r.text).toMatch(/^Обстановка на пять часов восемнадцатого апреля, ход три\./);
    expect(r.text).toMatch(/Главное за ход: восьмая гвардейская армия прорвала оборону у Зелова/);
    expect(r.text).toMatch(/Достигнуто: Зееловские высоты\./);
    expect(r.text).toMatch(/скажите «подробнее»/);
    expect(r.more.length + (r.text.match(/Главное за ход/) ? 1 : 0)).toBeLessThanOrEqual(EVENTS.length);
    expect(r.more.length).toBeGreaterThan(0);
  });
  it('первый ход и ход без событий — тоже 5–7 фраз', () => {
    for (const v of [view({ turn: 1, goals: [] }), view({ events: [], goals: [] }), view({ events: EVENTS.slice(0, 1) })]) {
      const r = situationReport(v);
      expect(sentences(r.text), r.text).toBeGreaterThanOrEqual(5);
      expect(sentences(r.text), r.text).toBeLessThanOrEqual(7);
      expect(r.text).not.toMatch(/\d/);
    }
    expect(situationReport(view({ turn: 1 })).text).toMatch(/Командование только что принято/);
  });
  it('разведсводка, доклад объединения, день журнала — числа словами', () => {
    expect(intelReport(view())).toMatch(/^Разведсводка: обнаружено четыре соединения противника — разведка видит до пятнадцати километров от наших войск\./);
    const u = unitReport(own.find((x) => x.id === 'su_8gva')!);
    expect(u).toMatch(/^восьмая гвардейская армия: наступает, у Зелова\./i);
    expect(u).toMatch(/прорыв на шесть километров/);
    expect(u).not.toMatch(/\d/);
    for (const t of [intelReport(view()), intelReport(view({ intel: [] })), journalDayText(view().journal[1])]) expect(t).not.toMatch(/\d/);
  });
});

describe('разбор фраз', () => {
  it('день: цифрами и словами, с месяцем', () => {
    expect(parseDay('семнадцатое апреля')).toEqual({ day: 17, month: 4 });
    expect(parseDay('18 апреля')).toEqual({ day: 18, month: 4 });
    expect(parseDay('двадцать первого')).toEqual({ day: 21 });
    expect(parseDay('пятого мая')).toEqual({ day: 5, month: 5 });
    expect(parseDay('этого момента')).toBeNull();
  });
  it('слои по названию — нестрого, без угадывания', () => {
    expect(findLayer('реки')).toBe('rivers');
    expect(findLayer('фронт')).toBe('front');
    expect(findLayer('исторический фронт')).toBe('hfront');
    expect(findLayer('линию фронта')).toBe('front');
    expect(findLayer('разграничительные линии')).toBe('bounds');
    expect(findLayer('подписи')).toBe('labels');
    expect(findLayer('котлы на карте')).toBe('pockets');
    expect(findLayer('Зелов')).toBeNull();
    expect(findLayer('реки', ['front'])).toBeNull();
  });
  it('окно «Принять командование»: принимаю, противник, отмена', () => {
    expect(takeoverParse('принимаю', { saved: false, enemy: 'llm' })).toEqual({ id: 'replay.start', params: { enemy: 'llm' } });
    expect(takeoverParse('принимаю', { saved: true, enemy: 'passive' })).toEqual({ id: 'replay.startOver', params: { enemy: 'passive' } });
    expect(takeoverParse('без штаба', { saved: false, enemy: 'llm' })).toEqual({ id: 'command.enemyMode', params: { mode: 'passive' } });
    expect(takeoverParse('штаб на модели', { saved: false, enemy: 'llm' })).toEqual({ id: 'command.enemyMode', params: { mode: 'llm' } });
    expect(takeoverParse('отмена', { saved: false, enemy: 'llm' })).toEqual({ id: 'replay.takeCommand.cancel' });
    expect(takeoverParse('открой карты', { saved: false, enemy: 'llm' })).toBeNull();
  });
  it('что показать: место, соединение, «N км от …», переспрос', () => {
    const v = view();
    expect(resolveTarget('Зелов', v)).toMatchObject({ at: zelov.at, label: 'Зелов' });
    expect(resolveTarget('восьмую гвардейскую', v)).toMatchObject({ who: { kind: 'own', id: 'su_8gva' } });
    expect(resolveTarget('пять километров севернее Зелова', v)).toHaveProperty('at');
    expect(resolveTarget('третью', v)).toHaveProperty('say'); // 3-я, 3-я ударная, 3-я гвардейская — переспрос
    expect(resolveTarget('Москва', v)).toEqual({ say: 'Не нашёл на карте «Москва».' });
  });
});

// ---------------------------------------------------------------- действия с поддельным состоянием

let offs: (() => void)[] = [];
let said: string[] = [];
let section = 'replay';
let t = 1_000_000;
const mk = () => new Dispatcher({ now: () => t, say: (s) => said.push(s), section: () => 'replay' });
const reg = (list: Action[]) => offs.push(...list.map(register));

function cmd(over: Partial<CommandDeps> = {}) {
  const d: CommandDeps = {
    view: view(), engine: { getView: () => ({ center: [14, 52], zoom: 7, bearing: 0 }), setView: vi.fn() },
    setTab: vi.fn(), showUnit: vi.fn(), showEnemy: vi.fn(), enemy: 'llm', setEnemy: vi.fn(), reveal: false, setReveal: vi.fn(), exit: vi.fn(), ...over,
  };
  reg(commandActions(() => d));
  return d;
}

beforeEach(() => {
  offs = []; said = []; section = 'replay'; t = 1_000_000;
  setSectionSource(() => section);
  offs.push(register({ id: 'shell.open', section: 'global', title: '', describe: '', available: () => true, run: async () => undefined }));
});
afterEach(() => { offs.forEach((o) => o()); setSpeaker(null); });

describe('командование голосом', () => {
  it('«Штаб, покажи Зелов» — вид карты на Зелов', async () => {
    const d = cmd();
    expect(await mk().utterance('Штаб, покажи Зелов', 1)).toBe('done');
    expect(d.engine!.setView).toHaveBeenCalledWith({ center: zelov.at, zoom: 10 });
    expect(said.at(-1)).toBe('Показываю: Зелов.');
  });
  it('«Штаб, покажи на карте Зееловские высоты» — не раздел «Карты», а место', async () => {
    const d = cmd();
    await mk().utterance('Штаб, покажи на карте Зееловские высоты', 1);
    expect(d.engine!.setView).toHaveBeenCalledTimes(1);
    expect(said.at(-1)).toMatch(/^Показываю: Зееловские высоты\./);
  });
  it('«Штаб, доложи о восьмой гвардейской» — доклад и карточка армии', async () => {
    const d = cmd();
    await mk().utterance('Штаб, доложи о восьмой гвардейской', 1);
    expect(d.showUnit).toHaveBeenCalledWith('su_8gva');
    expect(said.at(-1)).toMatch(/^восьмая гвардейская армия: наступает, у Зелова\. Укомплектованность восемьдесят шесть процентов/i);
  });
  it('«где восьмая гвардейская» — карточка и центр карты; противник — разведданные', async () => {
    const d = cmd();
    const disp = mk();
    await disp.utterance('Штаб, где восьмая гвардейская', 1);
    expect(d.showUnit).toHaveBeenCalledWith('su_8gva');
    expect(d.engine!.setView).toHaveBeenCalledWith({ center: [14.45, 52.6], zoom: 7 });
    await disp.utterance(`Штаб, доложи о ${intel[0].name}`, 2);
    expect(d.showEnemy).toHaveBeenCalledWith(intel[0].id);
    expect(said.at(-1)).toMatch(/^Противник/);
  });
  it('«доложи обстановку», затем «подробнее» — остальные донесения частями', async () => {
    const d = cmd();
    const disp = mk();
    await disp.utterance('Штаб, доложи обстановку', 1);
    expect(d.setTab).toHaveBeenCalledWith('reports');
    expect(said.at(-1)).toMatch(/^Обстановка на пять часов/);
    disp.spoke();
    await disp.utterance('подробнее', 2);
    expect(said.at(-1)).toMatch(/Штраусберг|Шпрее|Кюстрина/);
    expect(said.at(-1)).not.toMatch(/\d/);
  });
  it('вкладки, разведка, журнал, туман войны, масштаб', async () => {
    const d = cmd();
    const disp = mk();
    await disp.utterance('Штаб, открой приказы', 1);
    expect(d.setTab).toHaveBeenLastCalledWith('orders');
    await disp.utterance('Штаб, журнал', 2);
    expect(d.setTab).toHaveBeenLastCalledWith('journal');
    await disp.utterance('Штаб, что разведка?', 3);
    expect(d.setTab).toHaveBeenLastCalledWith('intel');
    expect(said.at(-1)).toMatch(/^Разведсводка/);
    await disp.utterance('Штаб, прочитай журнал за шестнадцатое апреля', 4);
    expect(said.at(-1)).toMatch(/^Журнал, шестнадцатого апреля/);
    await disp.utterance('Штаб, покажи всех', 5);
    expect(d.setReveal).toHaveBeenLastCalledWith(true);
    await disp.utterance('Штаб, верни туман войны', 6);
    expect(d.setReveal).toHaveBeenLastCalledWith(false);
    await disp.utterance('Штаб, приблизь', 7);
    expect(d.engine!.setView).toHaveBeenLastCalledWith({ center: [14, 52], zoom: 8 });
  });
  it('уровень карты, слой, участок — фразой в действие реестра', () => {
    for (const id of ['map.level', 'map.layer', 'map.sector', 'map.legend']) offs.push(register({ id, section: 'replay', title: id, describe: '', available: () => true, run: async () => undefined }));
    expect(parseCommand('оперативный уровень')).toEqual({ id: 'map.level', params: { level: 'op' } });
    expect(parseCommand('перейди на стратегический масштаб')).toEqual({ id: 'map.level', params: { level: 'st' } });
    expect(parseCommand('скрой реки')).toEqual({ id: 'map.layer', params: { layer: 'rivers', on: false } });
    expect(parseCommand('покажи исторический фронт')).toEqual({ id: 'map.layer', params: { layer: 'hfront', on: true } });
    expect(parseCommand('участок зееловские высоты')).toEqual({ id: 'map.sector', params: { name: 'зееловские высоты' } });
    expect(parseCommand('весь театр')).toEqual({ id: 'map.sector', params: { name: '' } });
    expect(parseCommand('легенда')).toEqual({ id: 'map.legend' });
  });
  it('«заверши и удали игру» — только после «да»; «выйди из игры» — сразу', async () => {
    const d = cmd();
    const disp = mk();
    await disp.utterance('Штаб, заверши и удали игру', 1);
    expect(said.at(-1)).toBe('Завершить игру и удалить её запись? Скажите «да» или «нет».');
    expect(d.exit).not.toHaveBeenCalled();
    await disp.utterance('да', 2);
    expect(d.exit).toHaveBeenCalledWith(true);
    await disp.utterance('Штаб, выйди из игры', 3);
    expect(d.exit).toHaveBeenLastCalledWith(false);
  });
  it('раздел в фоне — не исполняется, причина простыми словами', async () => {
    const d = cmd();
    section = 'editor';
    await mk().utterance('Штаб, доложи обстановку', 1);
    expect(said.at(-1)).toBe(`Сейчас нельзя: ${NOT_IN_REPLAY}.`);
    expect(await act('map.show', { name: 'Зелов' })).toBe(NOT_IN_REPLAY);
    expect(d.engine!.setView).not.toHaveBeenCalled();
    expect(d.setTab).not.toHaveBeenCalled();
  });
  it('обстановка ещё не пришла — «подождите»', async () => {
    cmd({ view: null });
    expect(await act('command.report')).toMatch(/обстановка ещё готовится/);
  });
  it('игра не идёт — «доложи обстановку» объясняет, как начать; «покажи Зелов» не перехватывается', async () => {
    await mk().utterance('Штаб, доложи обстановку', 1);
    expect(said.at(-1)).toBe(`Сейчас нельзя: ${NO_GAME}.`);
    expect(parseCommand('покажи зелов')).toBeNull();
    expect(parseCommand('доложи о восьмой гвардейской')).toBeNull();
  });
});

describe('вход в командование голосом', () => {
  const CATALOG = [
    { id: 'berlin-1945-tasks', title: 'Берлинская операция, 16.04–2.05.1945' },
    { id: 'berlin-city-1945', title: 'Бой в Берлине, 24.04–2.05.1945' },
    { id: 'vistula-oder-1945', title: 'Висло-Одерская операция, 12.01–3.02.1945' },
  ];
  function rep(over: Partial<ReplayDeps> = {}) {
    const d: ReplayDeps = {
      catalog: CATALOG, scenario: 'berlin-1945-tasks', busy: null, game: false, calc: vi.fn(), result: null, time: null,
      takeAt: (x) => `${x.slice(0, 10)}T05:00`, setTime: vi.fn(), openTake: vi.fn(), closeTake: vi.fn(), take: null, saved: null,
      begin: vi.fn(), continueGame: vi.fn(), ...over,
    };
    reg(replayActions(() => d));
    return d;
  }
  it('«рассчитай операцию [название]» — нестрого по названию; похожие — переспрос', async () => {
    const d = rep();
    const disp = mk();
    await disp.utterance('Штаб, рассчитай операцию', 1);
    expect(d.calc).toHaveBeenLastCalledWith('berlin-1945-tasks');
    expect(said.at(-1)).toMatch(/^Считаю: Берлинская операция\./);
    await disp.utterance('Штаб, рассчитай висло-одерскую операцию', 2);
    expect(d.calc).toHaveBeenLastCalledWith('vistula-oder-1945');
    await disp.utterance('Штаб, рассчитай бой в Берлине', 3);
    expect(d.calc).toHaveBeenLastCalledWith('berlin-city-1945');
    await disp.utterance('Штаб, рассчитай Берлин', 4);
    expect(said.at(-1)).toBe('Какую операцию: «Берлинская операция», «Бой в Берлине»?');
    expect(d.calc).toHaveBeenCalledTimes(3);
  });
  it('расчёт идёт / игра идёт / раздел в фоне — причина', async () => {
    rep({ busy: 'расчёт…' });
    expect(await act('replay.calc')).toMatch(/идёт расчёт/);
    offs.forEach((o) => o()); offs = [];
    rep({ game: true });
    expect(await act('replay.takeCommand')).toMatch(/идёт игра/);
    offs.forEach((o) => o()); offs = [];
    rep();
    section = 'knowledge';
    expect(await act('replay.calc')).toBe(NOT_IN_REPLAY);
  });
  it('«прими командование» без расчёта — сначала расчёт; с днём — с начала хода этого дня', async () => {
    rep();
    expect(await act('replay.takeCommand')).toMatch(/операция ещё не рассчитана/);
    offs.forEach((o) => o()); offs = [];
    const d = rep({ result: { scenarioName: 'Берлинская операция', start: '1945-04-16T05:00', end: '1945-05-02T05:00' }, time: '1945-04-16T05:00' });
    const disp = mk();
    await disp.utterance('Штаб, прими командование', 1);
    expect(d.openTake).toHaveBeenLastCalledWith('1945-04-16T05:00');
    await disp.utterance('Штаб, прими командование с восемнадцатого апреля', 2);
    expect(d.setTime).toHaveBeenLastCalledWith('1945-04-18T05:00');
    expect(d.openTake).toHaveBeenLastCalledWith('1945-04-18T05:00');
    await disp.utterance('Штаб, прими командование с десятого апреля', 3);
    expect(said.at(-1)).toMatch(/^Операция начинается шестнадцатого апреля/);
  });
  it('окно открыто: «принимаю» — игра; поверх незавершённой — только после «да»', async () => {
    const d = rep({ take: '1945-04-16T05:00' });
    expect(await act('replay.start', { enemy: 'passive' })).toMatch(/^Командование принято/);
    expect(d.begin).toHaveBeenCalledWith('passive');
    offs.forEach((o) => o()); offs = [];
    const d2 = rep({ take: '1945-04-16T05:00', saved: { title: 'Берлинская операция' } });
    expect(await act('replay.start')).toMatch(/незавершённая игра/);
    const disp = mk();
    // в окне ответы разбирает окно (takeoverParse) — здесь как его вызов
    await (disp as unknown as { execute(id: string, p?: unknown): Promise<string> }).execute('replay.startOver', { enemy: 'llm' });
    expect(said.at(-1)).toBe('Есть незавершённая игра. Начать новую? Запись прежней будет заменена. Скажите «да» или «нет».');
    expect(d2.begin).not.toHaveBeenCalled();
    await disp.utterance('да', 2);
    expect(d2.begin).toHaveBeenCalledWith('llm');
  });
  it('«продолжи игру» — только если есть незавершённая', async () => {
    rep();
    expect(await act('replay.continue')).toBe('незавершённой игры нет');
    offs.forEach((o) => o()); offs = [];
    const d = rep({ saved: { title: 'Берлинская операция, 16.04–2.05.1945' } });
    await mk().utterance('Штаб, продолжи игру', 1);
    expect(d.continueGame).toHaveBeenCalled();
    expect(said.at(-1)).toBe('Продолжаю игру: Берлинская операция.');
  });
});
