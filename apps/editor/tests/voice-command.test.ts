// «Переигровка» и «Командование» голосом: доклады без модели, разбор фраз, действия с поддельным состоянием
// (раздел в фоне, игры нет, расчёта нет), «покажи Зелов», «доложи о восьмой гвардейской», вход в командование.
import { getAction } from '../src/voice/registry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { places as simPlaces, Theatre, type GameRecord, type IntelReport, type Scenario, type TheatreData, type UnitReport } from '@def-ops/sim';
import type { TurnView } from '../src/sim/game-protocol';
import { act, markVoice, parsePhrase, register, setSpeaker, voiceRecent, type Action } from '../src/voice/registry';
import { Dispatcher, helpText, YES_NO_SAY } from '../src/voice/dispatch';
import {
  calcDoneText, calcFailText, commandActions, findLayer, findWho, releaseCommand, releaseReplay, NO_GAME, NOT_IN_REPLAY, parseCommand, parseDay, replayActions, resolveTarget, setSectionSource, takeoverParse, takeoverRead, takeoverIsAnswer, TAKEOVER_REMIND,
  type CommandDeps, type ReplayDeps,
} from '../src/voice/actions/command';
import { stopReading } from '../src/voice/dictation';
import { parseTurn, releaseTurn, turnActions, type TurnDeps } from '../src/voice/actions/turn';
import { spokenNumber } from '../src/voice/answers';
import { legendFor, shownLegend } from '../src/map-legend';
import { enemyReport, intelReport, journalDayText, situationReport, unitReport, whereText } from '../src/voice/report';
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
  it('окно «Принять командование» (Task 1b): сначала вопрос и как отвечать, потом подробности; кончается «Жду ответа.»; напоминание; ответы без «штаб»', () => {
    const r = takeoverRead({ day: 'шестнадцатого апреля', turn: 1, enemy: 'llm', down: false, saved: false });
    expect(r).toBe('Принять командование с шестнадцатого апреля? Скажите: «принимаю», «без штаба» или «штаб на модели», или «отмена». Противник — штаб на модели. Ход 1. Жду ответа.');
    const r2 = takeoverRead({ day: 'шестнадцатого апреля', turn: 3, enemy: 'passive', down: true, saved: true });
    // предупреждение — до вариантов
    expect(r2).toMatch(/^Принять командование с шестнадцатого апреля\? Незавершённая игра будет заменена\. Скажите: /);
    expect(r2).toMatch(/Противник — без штаба; модель сейчас не на связи\. Ход 3\. Жду ответа\.$/);
    // в «истории как замысле» «без штаба» не предлагается
    expect(takeoverRead({ day: 'шестнадцатого апреля', turn: 1, enemy: 'intent', down: false, saved: false, options: ['intent', 'llm'] }))
      .toBe('Принять командование с шестнадцатого апреля? Скажите: «принимаю» или «штаб на модели», или «отмена». Противник — история как замысел. Ход 1. Жду ответа.');
    expect(TAKEOVER_REMIND).toMatch(/Жду ответа\.$/);
    for (const x of ['принимаю', 'без штаба', 'штаб на модели', 'отмена']) expect(takeoverIsAnswer(x)).toBe(true);
    expect(takeoverIsAnswer('открой карты')).toBe(false);
  });
  it('окно «Принять командование»: принимаю, противник, отмена', () => {
    expect(takeoverParse('принимаю', { saved: false, enemy: 'llm' })).toEqual({ id: 'replay.start', params: { enemy: 'llm' } });
    expect(takeoverParse('принимаю', { saved: true, enemy: 'passive' })).toEqual({ id: 'replay.startOver', params: { enemy: 'passive' } });
    expect(takeoverParse('без штаба', { saved: false, enemy: 'llm' })).toEqual({ id: 'command.enemyMode', params: { mode: 'passive' } });
    expect(takeoverParse('штаб на модели', { saved: false, enemy: 'llm' })).toEqual({ id: 'command.enemyMode', params: { mode: 'llm' } });
    expect(takeoverParse('отмена', { saved: false, enemy: 'llm' })).toEqual({ id: 'replay.takeCommand.cancel' });
    // «история как замысел»: без слова «противник» — режим своей стороны, с ним — противник
    expect(takeoverParse('история как замысел', { saved: false, enemy: 'llm' })).toEqual({ id: 'command.gameMode', params: { mode: 'intent' } });
    expect(takeoverParse('режим история как замысел', { saved: false, enemy: 'llm' })).toEqual({ id: 'command.gameMode', params: { mode: 'intent' } });
    expect(takeoverParse('противник история как замысел', { saved: false, enemy: 'llm' })).toEqual({ id: 'command.enemyMode', params: { mode: 'intent' } });
    expect(takeoverParse('открой карты', { saved: false, enemy: 'llm' })).toBeNull();
  });
  it('что показать: место, соединение, «N км от …», переспрос', () => {
    const v = view();
    expect(resolveTarget('Зелов', v)).toMatchObject({ at: zelov.at, label: 'Зелов' });
    expect(resolveTarget('восьмую гвардейскую', v)).toMatchObject({ who: { kind: 'own', id: 'su_8gva' } });
    expect(resolveTarget('пять километров севернее Зелова', v)).toHaveProperty('at');
    expect(resolveTarget('третью', v)).toHaveProperty('say'); // 3-я, 3-я ударная, 3-я гвардейская — переспрос
    expect(resolveTarget('Москва', v)).toBeNull();
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
    setTab: vi.fn(), showUnit: vi.fn(), showEnemy: vi.fn(), enemy: 'llm', enemyChoices: ['llm', 'passive'], setEnemy: vi.fn(), reveal: false, setReveal: vi.fn(), exit: vi.fn(), ...over,
  };
  reg(commandActions(() => d));
  return d;
}

beforeEach(() => {
  offs = []; said = []; section = 'replay'; t = 1_000_000;
  setSectionSource(() => section);
  offs.push(register({ id: 'shell.open', section: 'global', title: '', describe: '', available: () => true, run: async () => undefined }));
});
afterEach(() => { offs.forEach((o) => o()); setSpeaker(null); stopReading(); });

describe('командование голосом', () => {
  it('«противник без штаба» в «истории как замысле» отклонён: назван допустимый список', async () => {
    const d = cmd({ enemyChoices: ['llm'] });
    const r = await getAction('command.enemyMode')!.run({ mode: 'passive' });
    expect(d.setEnemy).not.toHaveBeenCalled();
    expect(r).toBe('В этом режиме игры противник — только штаб на модели.');
  });
  it('«противник без штаба» там, где допустим, ставится', async () => {
    const d = cmd();
    await getAction('command.enemyMode')!.run({ mode: 'passive' });
    expect(d.setEnemy).toHaveBeenCalledWith('passive');
  });
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
  it('«Штаб, покажи карту» / «открой карту» в игре — карта командования (весь театр), а не раздел «Карты»', async () => {
    cmd();
    const sector = vi.fn(async () => 'Весь театр.');
    offs.push(register({ id: 'map.sector', section: 'replay', title: 'Участок', describe: '', available: () => true, run: sector }));
    const opens: unknown[] = [];
    offs.push(register({ id: 'shell.open', section: 'global', title: '', describe: '', available: () => true, run: async (p: unknown) => { opens.push(p); } }));
    for (const [i, w] of ['Штаб, покажи карту', 'Штаб, открой карту'].entries()) {
      expect(await mk().utterance(w, i + 1), w).toBe('done');
    }
    expect(sector).toHaveBeenCalledTimes(2);
    expect(sector).toHaveBeenCalledWith({ name: '' });
    expect(opens).toEqual([]);
  });
  it('«Штаб, покажи карту» без карты операции — раздел «Карты», как прежде', async () => {
    const opens: unknown[] = [];
    offs.push(register({ id: 'shell.open', section: 'global', title: '', describe: '', available: () => true, run: async (p: unknown) => { opens.push(p); } }));
    await mk().utterance('Штаб, покажи карту', 1);
    expect(opens).toEqual([{ section: 'maps' }]);
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
    // прежние названия уровней — по содержанию карты
    expect(parseCommand('оперативный уровень', 'replay')).toEqual({ id: 'map.level', params: { level: 'front' } });
    expect(parseCommand('перейди на стратегический масштаб', 'replay')).toEqual({ id: 'map.level', params: { level: 'stavka' } });
    expect(parseCommand('тактический уровень', 'replay')).toEqual({ id: 'map.level', params: { level: 'division' } });
    // уровни по ступеням
    expect(parseCommand('уровень армии', 'replay')).toEqual({ id: 'map.level', params: { level: 'army' } });
    expect(parseCommand('перейди на уровень ставки', 'replay')).toEqual({ id: 'map.level', params: { level: 'stavka' } });
    expect(parseCommand('корпусной уровень', 'replay')).toEqual({ id: 'map.level', params: { level: 'corps' } });
    expect(parseCommand('уровень дивизии', 'replay')).toEqual({ id: 'map.level', params: { level: 'division' } });
    expect(parseCommand('уровень фронта', 'replay')).toEqual({ id: 'map.level', params: { level: 'front' } });
    expect(parseCommand('скрой реки', 'replay')).toEqual({ id: 'map.layer', params: { layer: 'rivers', on: false } });
    expect(parseCommand('покажи исторический фронт', 'replay')).toEqual({ id: 'map.layer', params: { layer: 'hfront', on: true } });
    expect(parseCommand('участок зееловские высоты', 'replay')).toEqual({ id: 'map.sector', params: { name: 'зееловские высоты' } });
    expect(parseCommand('весь театр', 'replay')).toEqual({ id: 'map.sector', params: { name: '' } });
    expect(parseCommand('легенда', 'replay')).toEqual({ id: 'map.legend' });
  });
  it('элемент легенды, который есть на карте уровня, — фразой «скрой / покажи …»', () => {
    for (const id of ['map.layer', 'map.legend.item']) offs.push(register({ id, section: 'replay', title: id, describe: '', available: () => true, run: async () => undefined }));
    shownLegend.items = legendFor('stavka'); shownLegend.level = 'stavka';
    expect(parseCommand('скрой отходы', 'replay')).toEqual({ id: 'map.legend.item', params: { item: 'retreat', on: false } });
    expect(parseCommand('покажи удары противника', 'replay')).toEqual({ id: 'map.legend.item', params: { item: 'blow-enemy', on: true } });
    // слой — по-прежнему слоем; чего нет в легенде — не элемент легенды
    expect(parseCommand('скрой реки', 'replay')).toEqual({ id: 'map.layer', params: { layer: 'rivers', on: false } });
    shownLegend.items = [];
    expect(parseCommand('скрой отходы', 'replay')).not.toEqual(expect.objectContaining({ id: 'map.legend.item' }));
  });
  it('«заверши и удали игру» — только после «да»; «выйди из игры» — сразу', async () => {
    const d = cmd();
    const disp = mk();
    await disp.utterance('Штаб, заверши и удали игру', 1);
    expect(said.at(-1)).toBe(`Завершить игру и удалить её запись? ${YES_NO_SAY}`);
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
    expect(parseCommand('покажи зелов', 'replay')).toBeNull();
    expect(parseCommand('доложи о восьмой гвардейской', 'replay')).toBeNull();
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
      begin: vi.fn(), continueGame: vi.fn(), stop: vi.fn(), discardSaved: vi.fn(), ...over,
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
    expect(d.begin).toHaveBeenCalledWith('passive', undefined);
    // противник не назван — умолчание окна по режиму (не штаб на модели)
    await act('replay.start', { mode: 'intent' });
    expect(d.begin).toHaveBeenLastCalledWith(undefined, 'intent');
    offs.forEach((o) => o()); offs = [];
    const d2 = rep({ take: '1945-04-16T05:00', saved: { title: 'Берлинская операция' } });
    expect(await act('replay.start')).toMatch(/незавершённая игра/);
    const disp = mk();
    // в окне ответы разбирает окно (takeoverParse) — здесь как его вызов
    await (disp as unknown as { execute(id: string, p?: unknown): Promise<string> }).execute('replay.startOver', { enemy: 'llm' });
    expect(said.at(-1)).toBe(`Есть незавершённая игра. Начать новую? Запись прежней будет заменена. ${YES_NO_SAY}`);
    expect(d2.begin).not.toHaveBeenCalled();
    await disp.utterance('да', 2);
    expect(d2.begin).toHaveBeenCalledWith('llm', undefined);
  });
  it('противник, недопустимый при режиме, заменён — ответ называет того, кто в силе', async () => {
    const d = rep({ take: '1945-04-16T05:00', begin: vi.fn(() => 'intent' as const) });
    const r = await act('replay.start', { enemy: 'passive', mode: 'intent' });
    expect(d.begin).toHaveBeenCalledWith('passive', 'intent');
    expect(r).toBe('Командование принято. Противник «без штаба» в режиме «История как замысел» недопустим — противник: история как замысел. Готовлю обстановку — скажу, когда будет готова.');
    // допустимый — без оговорки
    offs.forEach((o) => o()); offs = [];
    rep({ take: '1945-04-16T05:00', begin: vi.fn(() => 'llm' as const) });
    expect(await act('replay.start', { enemy: 'llm', mode: 'intent' })).toBe('Командование принято. Готовлю обстановку — скажу, когда будет готова.');
  });
  it('«продолжи игру»: противник старой записи заменён — сообщение в ответе', async () => {
    rep({ saved: { title: 'Берлинская операция, 16.04–2.05.1945' }, continueGame: vi.fn(() => 'Игра продолжена с противником «история как замысел».') });
    await mk().utterance('Штаб, продолжи игру', 1);
    expect(said.at(-1)).toBe('Продолжаю игру: Берлинская операция. Игра продолжена с противником «история как замысел».');
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

// ---------------------------------------------------------------- раунд 1: поправки по рецензии

describe('ложные перехваты: обычные вопросы — модели', () => {
  const QUESTIONS = [
    'где лучше наступать', 'что с подвозом', 'что у противника на флангах', 'как там с погодой', 'покажи как отдать приказ',
    'к чему приведет удар', 'где настройки', 'где мои войска', 'что по снабжению', 'как там у соседей', 'покажи почему так вышло',
    'доложи о погоде', 'где здесь ошибка', 'что с нашими потерями', 'покажи что изменилось', 'где сейчас лучше обороняться',
  ];
  it('в игре: обычные вопросы не перехватываются (фраза уходит модели)', () => {
    cmd();
    for (const q of QUESTIONS) expect(parsePhrase(q, 'replay'), q).toBeNull();
  });
  it('в игре: вопрос с моделью доходит до модели, а не «Не нашёл…»', async () => {
    cmd();
    const model = vi.fn(async () => ({ say: 'Подвоз идёт по плану.' }));
    const disp = new Dispatcher({ now: () => t, say: (s) => said.push(s), section: () => 'replay', model });
    await disp.utterance('Штаб, что с подвозом', 1);
    expect(model).toHaveBeenCalled();
    expect(said.join(' ')).not.toMatch(/Не нашёл/);
  });
  it('названия, которые есть, по-прежнему понимаются', () => {
    cmd();
    expect(parsePhrase('покажи зелов', 'replay')).toEqual({ id: 'map.show', params: { name: 'зелов' } });
    expect(parsePhrase('где восьмая гвардейская', 'replay')).toEqual({ id: 'command.unit.show', params: { name: 'восьмая гвардейская' } });
    expect(parsePhrase('что с третьей', 'replay')).toEqual({ id: 'command.unit.report', params: { name: 'третьей' } }); // переспрос — тоже ответ
  });
});

describe('разборщик знает раздел', () => {
  const MAP = ['map.level', 'map.layer', 'map.sector', 'map.legend'];
  it('в «Знаниях» фразы командования не перехватываются, даже если игра идёт', () => {
    cmd();
    for (const id of MAP) offs.push(register({ id, section: 'replay', title: id, describe: '', available: () => true, run: async () => undefined }));
    for (const q of ['покажи реки', 'легенда', 'журнал', 'приблизь', 'что нового', 'доложи обстановку', 'оперативный уровень', 'покажи зелов'])
      expect(parsePhrase(q, 'knowledge'), q).toBeNull();
  });
  it('вне игры в «Редакторе» — тоже не перехватываются', () => {
    for (const q of ['приблизь', 'легенда', 'что нового', 'доклад']) expect(parsePhrase(q, 'editor'), q).toBeNull();
  });
  it('вход — из любого раздела: переход в «Переигровку» и действие', async () => {
    const calc = vi.fn();
    let where = 'knowledge';
    setSectionSource(() => where);
    offs.forEach((o) => o()); offs = [];
    offs.push(register({ id: 'shell.open', section: 'global', title: '', describe: '', available: () => true, run: async (p: { section: string }) => { where = p.section; } }));
    reg(replayActions(() => ({
      catalog: [{ id: 'berlin-1945-tasks', title: 'Берлинская операция' }], scenario: 'berlin-1945-tasks', busy: null, game: false, calc, result: null, time: null,
      takeAt: (x) => x, setTime: vi.fn(), openTake: vi.fn(), closeTake: vi.fn(), take: null, saved: null, begin: vi.fn(), continueGame: vi.fn(), stop: vi.fn(), discardSaved: vi.fn(),
    })));
    const disp = new Dispatcher({ now: () => t, say: (s) => said.push(s), section: () => where });
    await disp.utterance('Штаб, рассчитай операцию', 1);
    expect(where).toBe('replay');
    expect(calc).toHaveBeenCalledWith('berlin-1945-tasks');
  });
});

describe('«подробнее» — только к докладу этого хода', () => {
  it('новый ход, выход и новая игра сбрасывают остальные донесения', async () => {
    const d = cmd();
    await act('command.report');
    expect(parsePhrase('подробнее', 'replay')).toEqual({ id: 'command.report.more' });
    d.view = view({ turn: 4, time: '1945-04-19T05:00' });
    expect(parsePhrase('подробнее', 'replay')).toBeNull();
    expect(await act('command.report.more')).toMatch(/сначала доклад/);
    d.view = view();
    await act('command.report');
    await act('command.exit');
    expect(await act('command.report.more')).toMatch(/сначала доклад/);
    await act('command.report');
    offs.forEach((o) => o()); offs = [];
    cmd(); // новая игра — новые действия
    expect(await act('command.report.more')).toMatch(/сначала доклад/);
  });
});

describe('«что я могу сказать» — сначала раздел', () => {
  it('в игре — примеры командования, общих не больше двух', () => {
    for (const s of ['штаб, открой переигровку', 'штаб, калибровка', 'штаб, голоса', 'штаб, отбой'])
      offs.push(register({ id: `g.${s}`, section: 'global', title: s, describe: '', say: [s], available: () => true, run: async () => undefined }));
    cmd();
    const ex = helpText('replay').match(/«[^»]+»/g)!;
    expect(ex[0]).toBe('«штаб, доложи обстановку»');
    expect(ex.filter((e) => /открой переигровку|калибровка|голоса|отбой/.test(e)).length).toBeLessThanOrEqual(2);
  });
});

describe('мелкие поправки', () => {
  it('одинаковые номер и тип у своих и противника — переспрос; «наш» / «противника» — выбор', () => {
    const v = view({
      own: [...own, unitRep({ id: 'su_x56', name: '56-й танковый корпус', parent: null })],
      intel: [...intel, { ...intel[0], id: 'de_56tk', name: '56-й танковый корпус (Вейдлинг)' }],
    });
    expect(findWho('пятьдесят шестой танковый корпус', v)).toEqual({ say: 'Наш «56-й танковый корпус» или противника «56-й танковый корпус»?' });
    expect(findWho('наш пятьдесят шестой танковый корпус', v)).toMatchObject({ who: { id: 'su_x56' } });
    expect(findWho('пятьдесят шестой танковый корпус противника', v)).toMatchObject({ who: { id: 'de_56tk' } });
    expect(findWho('восьмая гвардейская', v)).toMatchObject({ who: { id: 'su_8gva' } });
  });
  it('«рассчитай заново / ещё раз» — текущая операция; «расчёт готов?» — не команда', async () => {
    const calc = vi.fn();
    reg(replayActions(() => ({
      catalog: [{ id: 'a', title: 'Берлинская операция' }, { id: 'b', title: 'Бой в Берлине' }], scenario: 'b', busy: null, game: false, calc, result: null, time: null,
      takeAt: (x) => x, setTime: vi.fn(), openTake: vi.fn(), closeTake: vi.fn(), take: null, saved: null, begin: vi.fn(), continueGame: vi.fn(), stop: vi.fn(), discardSaved: vi.fn(),
    })));
    for (const q of ['рассчитай заново', 'рассчитай еще раз', 'рассчитай её снова', 'пересчитай']) {
      const h = parsePhrase(q, 'replay');
      expect(h, q).toMatchObject({ id: 'replay.calc' });
      expect(await act('replay.calc', (h as { params?: unknown }).params), q).toMatch(/^Считаю: Бой в Берлине/);
    }
    expect(parsePhrase('расчет готов', 'replay')).toBeNull();
    expect(calc).toHaveBeenCalledTimes(4);
  });
  it('«Расчёт готов.» — коротко; подсказка — если голосом пользовались недавно; сбой — причина словами', () => {
    expect(calcDoneText('Берлинская операция, 16.04–2.05.1945', false)).toBe('Расчёт готов: Берлинская операция.');
    expect(calcDoneText('Берлинская операция', true)).toBe('Расчёт готов: Берлинская операция. Чтобы командовать самому, скажите: «Штаб, прими командование».');
    expect(calcFailText('нет данных театра: 12 районов без центра')).toBe('Расчёт не удался: нет данных театра: двенадцать районов без центра.');
  });
  it('реплика штабу отмечает, что голосом пользуются', async () => {
    markVoice(-Infinity);
    expect(voiceRecent()).toBe(false);
    await mk().utterance('Штаб, слушай', 1);
    expect(voiceRecent()).toBe(true);
    markVoice(Date.now() - 6 * 60_000);
    expect(voiceRecent()).toBe(false);
  });
});

// ---------------------------------------------------------------- раунд 2: расчёт — только по названию операции

describe('«рассчитай …» — только операция из каталога', () => {
  const deps = (calc = vi.fn()): ReplayDeps => ({
    catalog: [{ id: 'berlin-1945-tasks', title: 'Берлинская операция, 16.04–2.05.1945' }, { id: 'berlin-city-1945', title: 'Бой в Берлине, 24.04–2.05.1945' }],
    scenario: 'berlin-1945-tasks', busy: null, game: false, calc, result: null, time: null,
    takeAt: (x) => x, setTime: vi.fn(), openTake: vi.fn(), closeTake: vi.fn(), take: null, saved: null, begin: vi.fn(), continueGame: vi.fn(), stop: vi.fn(), discardSaved: vi.fn(),
  });
  it('посторонний хвост — не команда (и раздел не переключается)', async () => {
    const get = () => d;
    const d = deps();
    reg(replayActions(get));
    expect(parsePhrase('посчитай сколько статей', 'knowledge')).toBeNull();
    for (const q of ['рассчитай потери', 'посчитай потери противника', 'посчитай сколько дней осталось', 'рассчитай силы для удара'])
      expect(parsePhrase(q, 'replay'), q).toBeNull();
  });
  it('операция по названию, заново, без названия — команда', () => {
    reg(replayActions(() => deps()));
    expect(parsePhrase('рассчитай операцию', 'replay')).toEqual({ id: 'replay.calc', params: {} });
    expect(parsePhrase('рассчитай берлинскую', 'replay')).toEqual({ id: 'replay.calc', params: { operation: 'берлинскую' } });
    expect(parsePhrase('рассчитай берлинскую операцию', 'knowledge')).toEqual({ id: 'replay.calc', params: { operation: 'берлинскую' }, section: 'replay' });
    expect(parsePhrase('рассчитай заново', 'replay')).toEqual({ id: 'replay.calc', params: {} });
    expect(parsePhrase('рассчитай берлин', 'replay')).toEqual({ id: 'replay.calc', params: { operation: 'берлин' } }); // переспрос — тоже ответ
  });
  it('ссылки на действия снимаются вместе с ними', () => {
    const get = () => deps();
    const off = replayActions(get).map(register);
    expect(parsePhrase('рассчитай берлинскую', 'replay')).not.toBeNull();
    off.forEach((o) => o());
    releaseReplay(get);
    expect(parsePhrase('рассчитай берлинскую', 'knowledge')).toBeNull();
    const cget = () => ({ view: view() } as CommandDeps);
    reg(commandActions(cget));
    releaseCommand(cget);
    expect(parsePhrase('покажи зелов', 'replay')).toBeNull();
  });
  it('техническая ошибка расчёта — «внутренняя ошибка, подробности на экране»', () => {
    expect(calcFailText("TypeError: Cannot read properties of undefined (reading 'x')")).toBe('Расчёт не удался: внутренняя ошибка, подробности на экране.');
    expect(calcFailText('нет данных театра')).toBe('Расчёт не удался: нет данных театра.');
  });
});

describe('доклады — род и падеж (speech.ts)', () => {
  it('«двадцать девятый гвардейский стрелковый корпус», «около двухсот танков»', () => {
    expect(whereText(unitRep({ id: 'x', name: '29-й гв. ск (8 гв. А)', parent: null }))).toBe('двадцать девятый гвардейский стрелковый корпус: наступает, у Зелова.');
    expect(enemyReport({ ...intel[0], name: '56-й тк', estimate: 'до 20 тыс. чел., около 200 танков и САУ', nearest: null }))
      .toMatch(/до двадцати тысяч человек, около двухсот танков/);
  });
});

describe('возврат к ходу и ветви голосом', () => {
  const REC3 = { version: 1, scenario: 'berlin-1945-tasks', takeover: '1945-04-16T05:00',
    turns: ['1945-04-16T05:00', '1945-04-17T05:00', '1945-04-18T05:00'].map((time) => ({ time, orders: [], actions: [] })) } as unknown as GameRecord;
  const LINES = [
    { id: null, name: 'основная линия', turns: 3, from: null, current: true },
    { id: 'b1', name: 'ветвь от хода 2 (17 апреля, 05:00)', turns: 5, from: 2, current: false },
  ];
  function td(over: Partial<TurnDeps> = {}) {
    const d = {
      view: view(), prev: null, busy: null, blocked: null, enemy: 'llm', ai: { state: 'off' }, aiTurns: [], record: REC3,
      drafts: {}, acts: [], decision: { assessment: '', enemyIntent: '', intent: '', report: '', risks: '' }, plan: null, planN: 2,
      sendTurn: vi.fn(), retryAi: vi.fn(), skipAi: vi.fn(), setTab: vi.fn(), setUmpirePart: vi.fn(), showMissing: vi.fn(), notice: vi.fn(),
      review: { open: false, ctl: null, show: vi.fn() }, journal: () => ({ name: 'j.md', text: '' }), gameRecord: () => null,
      lines: LINES, branches: { open: false, show: vi.fn() },
      rewind: vi.fn(async (n: number) => ({ ok: true as const, at: REC3.turns[n - 1].time, branch: `ветвь от хода ${n} (17 апреля, 05:00)` })),
      switchBranch: vi.fn(async () => ({ ok: true as const, name: 'ветвь от хода 2 (17 апреля, 05:00)', turns: 5 })),
      deleteBranch: vi.fn(async () => null),
      ...over,
    } as unknown as TurnDeps;
    const get = () => d;
    reg(turnActions(get));
    offs.push(() => releaseTurn(get));
    return d;
  }
  it('spokenNumber: цифры, количественные и порядковые 1–99', () => {
    expect(spokenNumber('5')).toBe(5);
    expect(spokenNumber('пять')).toBe(5);
    expect(spokenNumber('пятому')).toBe(5);
    expect(spokenNumber('двадцать первому')).toBe(21);
    expect(spokenNumber('второму')).toBe(2);
    expect(spokenNumber('одиннадцатому')).toBe(11);
    expect(spokenNumber('пятьдесят')).toBe(50);
    expect(spokenNumber('ветер')).toBeNull();
  });
  it('фразы возврата и ветвей — только в «Переигровке»', () => {
    td();
    expect(parseTurn('вернись к ходу пять', 'replay')).toEqual({ id: 'command.rewind', params: { turn: 5 } });
    expect(parseTurn('вернись на ход назад', 'replay')).toEqual({ id: 'command.rewind.back', params: undefined });
    expect(parseTurn('покажи ветви', 'replay')).toEqual({ id: 'command.branches.show', params: undefined });
    expect(parseTurn('перейди на ветвь от хода пять', 'replay')).toEqual({ id: 'command.branch.switch', params: { name: 'ветвь от хода пять' } });
    expect(parseTurn('вернись к ходу пять', 'maps')).toBeNull();
    expect(parseTurn('покажи ветви', 'editor')).toBeNull();
  });
  it('«вернись к ходу N»: пока ход считается — причина; проект непустой — предложение со строгим «да»', async () => {
    td({ busy: 'расчёт хода…' });
    expect(getAction('command.rewind')!.check!({ turn: 2 })).toMatch(/^идёт расчёт хода/);
    offs.forEach((o) => o()); offs = [];
    td({ drafts: { su_8gva: { formation: 'su_8gva', task: 'attack', target: 'Seelow', targetText: 'Зелов', at: null, note: '' } } as never });
    const o = getAction('command.rewind')!.check!({ turn: 2 });
    expect(o).toMatchObject({ id: 'command.rewind.force', params: { turn: 2 }, strict: true });
    expect((o as { offer: string }).offer).toBe('В проекте хода есть приказы и распоряжения — при возврате они пропадут. Вернуться к ходу 2?');
  });
  it('возврат: ответ с датой и прежней линией', async () => {
    const d = td();
    expect(getAction('command.rewind')!.check!({ turn: 2 })).toBe(true);
    expect(await getAction('command.rewind')!.run({ turn: 2 })).toBe('Вернулся к ходу 2 (17 апреля, 05:00). Прежняя линия сохранена: «ветвь от хода 2 (17 апреля, 05:00)».');
    expect(d.rewind).toHaveBeenCalledWith(2);
    (d.rewind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, at: '1945-04-18T05:00', branch: null });
    expect(await getAction('command.rewind.back')!.run(undefined)).toBe('Вернулся к ходу 3 (18 апреля, 05:00).');
    (d.rewind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, text: 'идёт расчёт хода — вернуться можно, когда он закончится' });
    expect(await getAction('command.rewind')!.run({ turn: 1 })).toBe('Идёт расчёт хода — вернуться можно, когда он закончится.');
  });
  it('«вернись на ход назад» на первом ходе — некуда', () => {
    td({ record: { ...REC3, turns: [] } as GameRecord });
    expect(getAction('command.rewind.back')!.available()).toBe('вернуться некуда: это первый ход');
  });
  it('переход на ветвь: пока ход считается — отказ; проект непустой — то же предложение, что при возврате', async () => {
    td({ busy: 'расчёт хода…' });
    expect(getAction('command.branch.switch')!.check!({ name: 'ветвь от хода два' })).toMatch(/^идёт расчёт хода/);
    offs.forEach((o) => o()); offs = [];
    const d = td({ acts: [{ key: 'p', action: { kind: 'priority' }, label: 'x', text: 'y' }] as never });
    const o = getAction('command.branch.switch')!.check!({ name: 'ветвь от хода два' });
    expect(o).toMatchObject({ id: 'command.branch.switch.force', params: { name: 'ветвь от хода два' }, strict: true });
    expect((o as { offer: string }).offer).toBe('В проекте хода есть приказы и распоряжения — при переходе они пропадут. Перейти на ветвь «ветвь от хода 2 (17 апреля, 05:00)»?');
    expect(await getAction('command.branch.switch.force')!.run({ name: 'ветвь от хода два' })).toBe('Перешёл на ветвь «ветвь от хода 2 (17 апреля, 05:00)»: ход 6.');
    expect(d.switchBranch).toHaveBeenCalledWith('b1');
  });
  it('«покажи ветви» и переход на ветвь', async () => {
    const d = td();
    expect(await getAction('command.branches.show')!.run(undefined)).toBe('Ветвей 1: основная линия — текущая, ходов 3; ветвь от хода 2 (17 апреля, 05:00), ходов 5.');
    expect(d.branches.show).toHaveBeenCalledWith(true);
    expect(await getAction('command.branch.switch')!.run({ name: 'основную линию' })).toBe('Вы и так на ветви «основная линия».');
    expect(await getAction('command.branch.switch')!.run({ name: 'ветвь от хода второго' })).toBe('Перешёл на ветвь «ветвь от хода 2 (17 апреля, 05:00)»: ход 6.');
    expect(d.switchBranch).toHaveBeenCalledWith('b1');
    offs.forEach((o) => o()); offs = [];
    td({ lines: [LINES[0]] });
    expect(await getAction('command.branches.show')!.run(undefined)).toBe('Ветвей нет: игра идёт одной линией.');
  });
});

describe('продолжить игру с ветви', () => {
  const LS = [{ id: null, name: 'основная линия', turns: 3, from: null, current: true }, { id: 'b1', name: 'ветвь от хода 2 (17 апреля, 05:00)', turns: 5, from: 2, current: false }];
  const rep = (continueGame: ReplayDeps['continueGame']) => {
    const d = { catalog: [], scenario: 'berlin-1945-tasks', busy: null, game: false, calc: vi.fn(), result: null, time: null, takeAt: (x: string) => x, setTime: vi.fn(),
      openTake: vi.fn(), closeTake: vi.fn(), take: null, saved: { title: 'Берлинская операция, 16.04–2.05.1945', lines: LS }, begin: vi.fn(), continueGame: vi.fn(continueGame), stop: vi.fn(), discardSaved: vi.fn() } as unknown as ReplayDeps;
    reg(replayActions(() => d));
    return d;
  };
  it('ветвь — по названию; сбой — только он, без «Продолжаю игру»', async () => {
    const d = rep(async () => ({ error: 'ветвь не открылась: хранилище недоступно' }));
    expect(await getAction('replay.continue')!.run({ branch: 'ветвь от хода два' })).toBe('Ветвь не открылась: хранилище недоступно.');
    expect(d.continueGame).toHaveBeenCalledWith('b1');
  });
  it('удачно — «Продолжаю игру…» с названием ветви и заметкой о противнике', async () => {
    rep(async () => 'Противник заменён.');
    expect(await getAction('replay.continue')!.run({ branch: 'ветвь от хода два' })).toBe('Продолжаю игру: Берлинская операция, ветвь от хода 2 (17 апреля, 05:00). Противник заменён.');
  });
});
