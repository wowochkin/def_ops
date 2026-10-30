// «Командование» голосом — советник, решение, приказы, распоряжения: действия с поддельным состоянием (как в
// CommandView), разбор фраз без модели, ложные перехваты, озвучка ответов советника.
import { setSpeakAnswers, speakAnswersOn } from '../src/voice/advisor-voice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { places as simPlaces, Theatre, type ActionCheck, type IntelReport, type Scenario, type TheatreData, type UnitReport } from '@def-ops/sim';
import type { AdviceView, HumanDecision, PlanVariantView, TurnView } from '../src/sim/game-protocol';
import { act, getAction, parsePhrase, register, setRetractor, setSpeaker, type Action } from '../src/voice/registry';
import { SayGate } from '../src/voice/panel-state';
import { nameCase } from '../src/voice/speech';
import { Dispatcher, YES_NO_SAY } from '../src/voice/dispatch';
import { commandActions, setSectionSource, type CommandDeps } from '../src/voice/actions/command';
import {
  adviceArrived, adviceReady, commanderAction, decisionMissing, draftReportText, parseStaff, planArrived, press, projectHas, releaseCommander, releaseStaff, staffActions, taskOf, variantText,
  type OrderDraft, type PlanState, type StaffAct, type StaffDeps,
} from '../src/voice/actions/staff';
import { parseDictation, stopReading } from '../src/voice/dictation';
import { flash, flashState } from '../src/voice/highlight';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945-tasks.json';

const T = new Theatre(theatreFile as unknown as TheatreData);
const P = simPlaces(T).map((p) => ({ id: p.id, title: p.title, at: p.at }));
const F = (scenarioFile as unknown as Scenario).formations;
const place = (start: string) => P.find((p) => p.title.startsWith(start))!;
const zelov = place('Зелов (');
const heights = place('Зееловские высоты');

const unitRep = (f: { id: string; name: string; parent: string | null }, over: Partial<UnitReport> = {}): UnitReport => ({
  id: f.id, name: f.name, parent: f.parent, echelon: 'army', status: 'active', at: [14.4, 52.55], place: 'у Зелова', posture: 'наступает',
  task: 'наступать', target: 'на Берлин', orderSource: 'script', personnel: 75_400, tanks: 120, guns: 900, strength: 0.86, ammo: 1.4, fuel: 0.9,
  fatigue: 0.3, cutOff: false, movedKm: 6, combats: [], pending: [], ...over,
} as UnitReport);
const armyF = F.filter((f) => f.side === 'su' && / армия/.test(f.name) && f.parent);
const own = armyF.map((f) => unitRep(f as never, f.id === 'su_3ua' ? { status: 'reserve', reserveFrom: '1945-04-18T05:00' } as Partial<UnitReport> : {}));
const intel: IntelReport[] = F.filter((f) => f.side === 'de').slice(0, 4).map((f, i) => ({
  id: f.id, name: f.name, at: [14.2 + i * 0.1, 52.5], place: 'у Мюнхеберга', posture: 'обороняется', estimate: 'до 20 тыс. чел.', fresh: i === 0,
  nearest: { name: '8-я гвардейская армия', km: 4 + i },
}));
const EMPTY: HumanDecision = { assessment: '', enemyIntent: '', intent: '', report: '', risks: '' };
const LAST: HumanDecision = { assessment: 'Противник держит высоты.', enemyIntent: 'Удержать Зееловские высоты.', intent: 'Главный удар — на Зелов.', report: 'Войска ведут бой.', risks: 'Контрудар с юга.' };
const view = (over: Partial<TurnView> = {}): TurnView => ({
  scenario: 'berlin-1945-tasks', scenarioName: 'Берлинская операция', rules: 'x', seed: 1, start: '1945-04-16T05:00', end: '1945-05-08T05:00',
  takeover: '1945-04-16T05:00', time: '1945-04-18T05:00', turnHours: 24, turn: 3, over: false, outcome: null,
  victory: 'Знамя Победы над рейхстагом', deadline: '1945-05-08T05:00', strength: 0.91, strengthBelow: 0.5,
  human: { id: 'su', name: 'СССР' }, ai: { id: 'de', name: 'Германия' }, terms: {} as TurnView['terms'],
  groups: F.filter((f) => f.side === 'su' && !f.parent).map((f) => ({ id: f.id, name: f.name })), own, intel,
  events: ['8-я гвардейская армия прорвала оборону у Зелова.', 'Переправа у Кюстрина действует.'], places: P,
  delays: { army: 6 }, detectKm: 15, goals: [], journal: [], doc: {} as TurnView['doc'],
  bases: [{ id: 'base1', name: 'Костшин (Kostrzyn)', at: [14.65, 52.59], state: 'active', activeFrom: null }, { id: 'base2', name: 'Губин (Gubin)', at: [14.73, 51.95], state: 'active', activeFrom: null }],
  priority: [], priorityMax: 3, supplyHours: {}, rangeHours: 24, bridges: [], parks: 2, lastDecision: LAST,
  sectors: [], boundaries: [], groupOf: {},
  armies: [{ id: 'su_8gva', name: '8-я гвардейская армия', group: 'su_1bf', at: [14.45, 52.6] }, { id: 'su_5ua', name: '5-я ударная армия', group: 'su_1bf', at: [14.5, 52.75] },
    { id: 'su_13a', name: '13-я армия', group: 'su_1uf', at: [14.7, 51.7] }],
  reserveGroups: [{ id: 'su_3ua', name: '3-я ударная армия', status: 'reserve', front: '1-й Белорусский фронт', members: ['su_3ua'] }],
  ...over,
} as TurnView);

const sug = (name: string, id: string, ok = true): AdviceView['suggestions'][number] => ({ formation: id, name, task: 'attack', target: zelov.id, targetText: zelov.title, at: zelov.at, why: 'главный удар', ok });
const variant = (title: string, over: Partial<PlanVariantView> = {}): PlanVariantView => ({
  title, idea: `Суть варианта «${title}»: удар через высоты.`, decision: { ...LAST, intent: `Замысел варианта «${title}».`, report: '' },
  orders: [sug('8-я гвардейская армия', 'su_8gva'), sug('5-я ударная армия', 'su_5ua'), sug('69-я армия', 'su_69a'), sug('33-я армия', 'su_33a'), sug('47-я армия', '', false)],
  acts: [{ key: 'priority', action: { kind: 'priority', side: 'su', formations: ['su_8gva'], issuedAt: '' }, label: 'Приоритет подвоза: 8-я гв. армия', text: 'ok', given: '', ok: true }],
  ...over,
});
const plan = (over: Partial<PlanState> = {}): PlanState => ({ id: 7, time: '1945-04-18T05:00', count: 2, variants: [variant('Удар на Зелов'), variant('Обход с севера')], progress: '', done: true, ...over });

// ---------------------------------------------------------------- поддельное состояние

let offs: (() => void)[] = [];
let said: string[] = [];
let section = 'replay';
let t = 1_000_000;
const reg = (list: Action[]) => offs.push(...list.map(register));
const mk = (model?: ConstructorParameters<typeof Dispatcher>[0]['model']) => new Dispatcher({ now: () => t, say: (s) => said.push(s), section: () => section, model });

function cmd(v: TurnView) {
  const d: CommandDeps = {
    view: v, engine: { getView: () => ({ center: [14, 52], zoom: 7, bearing: 0 }), setView: vi.fn() },
    setTab: vi.fn(), showUnit: vi.fn(), showEnemy: vi.fn(), enemy: 'llm', enemyChoices: ['llm', 'passive'], setEnemy: vi.fn(), reveal: false, setReveal: vi.fn(), exit: vi.fn(),
  };
  reg(commandActions(() => d));
}

type S = StaffDeps & { checks: StaffAct[] };
function staff(over: Partial<StaffDeps> = {}, check: (a: StaffAct['action']) => ActionCheck = () => ({ ok: true, text: 'будет готово ≈ 18.04 17:00' })): S {
  const d = {
    view: view(), busy: null, setTab: vi.fn(), setSub: vi.fn(), goTo: vi.fn(), select: vi.fn(),
    plan: null, planN: 3, askPlan: vi.fn(() => 7), stopAdvisor: vi.fn(), openVariant: vi.fn(), advisorBusy: false, advisorText: '', setAdvisorText: vi.fn(),
    applyPlan: vi.fn(async (i: number, only: boolean) => `${only ? 'Только решение' : 'Принят'} ${i}`),
    askAdvisor: vi.fn(() => 41), suggestions: [], takeSuggestion: vi.fn(),
    decision: { ...EMPTY }, drafts: {}, acts: [], checks: [],
    bounds: { a: '', b: '', pts: [] },
    ...over,
  } as unknown as S;
  d.setDecision = vi.fn((p: Partial<HumanDecision>) => { d.decision = { ...d.decision, ...p }; });
  d.setDraft = vi.fn((id: string, x: OrderDraft | null) => { const n = { ...d.drafts }; if (x) n[id] = x; else delete n[id]; d.drafts = n; });
  d.addAct = vi.fn(async (key: string, action: StaffAct['action'], label: string) => {
    const r = check(action);
    if (r.ok) d.acts = [...d.acts.filter((a) => a.key !== key), { key, action, label, text: r.text }];
    return r;
  });
  d.dropAct = vi.fn((key: string) => { d.acts = d.acts.filter((a) => a.key !== key); });
  d.commit = vi.fn(async (g: { id: string; name: string }, at: [number, number]) => d.addAct(`commit:${g.id}`, { kind: 'commit', side: 'su', formation: g.id, at, issuedAt: '' }, g.name));
  d.setBounds = vi.fn((b: StaffDeps['bounds']) => { d.bounds = b; });
  const get = () => d;
  reg(staffActions(get));
  offs.push(() => releaseStaff(get));
  return d;
}

beforeEach(() => {
  offs = []; said = []; section = 'replay'; t = 1_000_000;
  setSectionSource(() => section);
  offs.push(register({ id: 'shell.open', section: 'global', title: '', describe: '', available: () => true, run: async () => undefined }));
});
afterEach(() => { offs.forEach((o) => o()); stopReading(); });

// ---------------------------------------------------------------- приказы

describe('приказы голосом', () => {
  it('задача — нестрого по TASK_RU', () => {
    expect(taskOf('наступать')).toBe('attack');
    expect(taskOf('атакуй')).toBe('attack');
    expect(taskOf('занять оборону')).toBe('defend');
    expect(taskOf('отойти')).toBe('withdraw');
    expect(taskOf('удерживать любой ценой')).toBe('hold');
    expect(taskOf('контратаковать')).toBe('counterattack');
    expect(taskOf('в резерв')).toBe('reserve');
    expect(taskOf('defend')).toBe('defend');
    expect(taskOf('пообедать')).toBeNull();
  });
  it('«восьмой гвардейской наступать на Зеловские высоты» — черновик приказа с целью, штаб повторяет одной фразой', async () => {
    const d = staff();
    expect(await mk().utterance('Штаб, восьмой гвардейской наступать на Зеловские высоты', 1)).toBe('done');
    expect(d.drafts.su_8gva).toMatchObject({ formation: 'su_8gva', task: 'attack', target: heights.id, at: heights.at, targetText: heights.title });
    expect(said.at(-1)).toBe('Приказ: восьмая гвардейская армия — наступать, цель — Зееловские высоты. Дойдёт до войск через шесть часов.');
    expect(d.setTab).toHaveBeenLastCalledWith('orders');
  });
  it('противник — цель удара; «отойти к …» — пункт', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance(`Штаб, пятой ударной атаковать ${intel[1].name}`, 1);
    expect(d.drafts.su_5ua).toMatchObject({ task: 'attack', target: { formation: intel[1].id }, at: intel[1].at });
    expect(said.at(-1)).toMatch(/^Приказ: пятая ударная армия — наступать против /);
    await disp.utterance('Штаб, шестьдесят девятой армии отойти к Зелову', 2);
    expect(d.drafts.su_69a).toMatchObject({ task: 'withdraw', target: zelov.id });
  });
  it('нужна цель, а её нет — «Куда?»; ответ одним названием дополняет приказ', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, восьмой гвардейской наступать', 1);
    expect(d.drafts.su_8gva).toBeUndefined();
    expect(said.at(-1)).toMatch(/Куда наступать\?/);
    disp.spoke();
    await disp.utterance('на Зелов', 2);
    expect(d.drafts.su_8gva).toMatchObject({ task: 'attack', target: zelov.id });
  });
  it('без цели, где она не нужна, — «на месте»', async () => {
    const d = staff();
    await mk().utterance('Штаб, тридцать третьей армии оборонять', 1);
    expect(d.drafts.su_33a).toMatchObject({ task: 'defend', target: null, at: null });
    expect(said.at(-1)).toMatch(/^Приказ: тридцать третья армия — оборонять, на месте\./);
  });
  it('неоднозначное место — переспрос 2–3 вариантами, черновик не тронут; ответ выбирает', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, восьмой гвардейской наступать на Гросс', 1);
    expect(d.drafts.su_8gva).toBeUndefined();
    expect(said.at(-1)).toMatch(/^Какое место: «Гросс-Кёльциг», «Гросс-Шаксдорф»\?/);
    disp.spoke();
    await disp.utterance('Гросс-Кёльциг', 2);
    expect(d.drafts.su_8gva?.targetText).toMatch(/^Гросс-Кёльциг/);
  });
  it('нет такого места — честно и «Куда?»', async () => {
    const d = staff();
    await mk().utterance('Штаб, восьмой гвардейской наступать на Москву', 1);
    expect(d.drafts.su_8gva).toBeUndefined();
    expect(said.at(-1)).toMatch(/Не нашёл на карте «москву»\. Куда/);
  });
  it('указания, отмена, перечень приказов', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, восьмой гвардейской наступать на Зелов', 1);
    await disp.utterance('Штаб, указания: наступать вдоль шоссе ночью', 2);
    expect(d.drafts.su_8gva.note).toBe('Наступать вдоль шоссе ночью');
    await disp.utterance('Штаб, тридцать третьей армии оборонять', 3);
    await disp.utterance('Штаб, какие приказы отданы?', 4);
    expect(said.at(-1)).toMatch(/^Приказов в проекте два: восьмая гвардейская армия — наступать, Зелов; тридцать третья армия — оборонять, на месте\./);
    await disp.utterance('Штаб, отмени приказ восьмой гвардейской', 5);
    expect(d.drafts.su_8gva).toBeUndefined();
    expect(said.at(-1)).toBe('Приказ отменён: восьмая гвардейская армия.');
  });
});

// ---------------------------------------------------------------- советник

describe('советник голосом', () => {
  it('«дай два варианта» — просьба советнику; готово — перечень вариантов (только если просили голосом)', async () => {
    const d = staff();
    await mk().utterance('Штаб, дай два варианта', 1);
    expect(d.askPlan).toHaveBeenCalledWith(2);
    expect(said.at(-1)).toMatch(/^Прошу у советника два варианта/);
    expect(planArrived(plan())).toMatch(/^Советник предложил два варианта: первый — «Удар на Зелов», второй — «Обход с севера»\. Скажите: «подробнее о первом» или «выбираю первый»\.$/);
    expect(planArrived(plan())).toBeNull(); // второй раз — уже сказано
    expect(planArrived(plan({ id: 99 }))).toBeNull(); // просили кнопкой
  });
  it('«подробнее о втором» — раскрыть вариант и прочитать замысел и главные приказы частями', async () => {
    const d = staff({ plan: plan() });
    const disp = mk();
    await disp.utterance('Штаб, подробнее о втором', 1);
    expect(d.openVariant).toHaveBeenCalledWith(1);
    expect(said.at(-1)).toMatch(/^Вариант второй: «Обход с севера»\./);
    const all = variantText(plan().variants[1], 2);
    expect(all).toMatch(/Замысел варианта «Обход с севера»/);
    expect(all).toMatch(/Главные приказы: 8-я гвардейская армия — наступать, Зелов; 5-я ударная армия — наступать, Зелов; 69-я армия — наступать, Зелов, и ещё один\./);
    expect(all).not.toMatch(/47-я/);
  });
  it('«выбираю второй» при пустом проекте — сразу; при непустом — одно подтверждение «да»', async () => {
    const d = staff({ plan: plan() });
    const disp = mk();
    await disp.utterance('Штаб, выбираю второй', 1);
    expect(d.applyPlan).toHaveBeenCalledWith(1, false);
    d.decision = { ...EMPTY, assessment: 'Своё.' };
    await disp.utterance('Штаб, принимаю первый вариант', 2);
    expect(d.applyPlan).toHaveBeenCalledTimes(1);
    expect(said.at(-1)).toBe(`Заменить проект вариантом «Удар на Зелов»? Текущие решение, приказы и распоряжения будут заменены. ${YES_NO_SAY}`);
    await disp.utterance('да', 3);
    expect(d.applyPlan).toHaveBeenLastCalledWith(0, false);
    await disp.utterance('Штаб, только решение по второму', 4);
    expect(d.applyPlan).toHaveBeenLastCalledWith(1, true);
  });
  it('варианты не готовы, устарели, нет такого — причина', async () => {
    staff({ plan: plan({ done: false }) });
    expect(await act('command.variant.pick', { n: 1 })).toMatch(/советник ещё готовит/);
    offs.forEach((o) => o()); offs = [];
    staff({ plan: plan({ time: '1945-04-17T05:00' }) });
    expect(await act('command.variant.pick', { n: 1 })).toMatch(/прошлого хода/);
    offs.forEach((o) => o()); offs = [];
    staff({ plan: plan() });
    expect(await act('command.variant.pick', { n: 5 })).toMatch(/^Такого варианта нет: их два/);
    offs.forEach((o) => o()); offs = [];
    staff();
    expect(await act('command.variant.more', { n: 1 })).toMatch(/вариантов ещё нет/);
  });
  it('вопрос советнику: ответ по готовности — коротко, «подробнее» — остальное; «возьми приказ»', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, спроси советника: где лучше наступать завтра?', 1);
    expect(d.askAdvisor).toHaveBeenCalledWith('где лучше наступать завтра');
    expect(said.at(-1)).toMatch(/^Передал вопрос советнику/);
    const answer = 'Главный удар лучше наносить на Зелов. Там противник слабее. Подвоз доходит. Резерв стоит ввести к вечеру. Риск — контрудар с юга. Его парирует пятая ударная.';
    const r: AdviceView = { ok: true, answer, basis: [], unknowns: [], followUps: [], suggestions: [sug('8-я гвардейская армия', 'su_8gva'), sug('5-я ударная армия', 'su_5ua')] };
    const text = adviceArrived(41, r)!;
    expect(text).toMatch(/^Советник: Главный удар лучше наносить на Зелов\. Там противник слабее\. Подвоз доходит\./);
    expect(text).not.toMatch(/Риск/);
    expect(text).toMatch(/Предлагает приказы: первый — восьмая гвардейская армия — наступать, Зелов; второй — пятая ударная армия — наступать, Зелов\. Взять — скажите «возьми первый приказ»\. Остальное — скажите «подробнее»\./);
    setSpeakAnswers(false);
    expect(adviceArrived(41, r)).toBeNull();
    expect(adviceArrived(55, r)).toBeNull(); // спрашивали кнопкой, озвучка ответов выключена
    setSpeakAnswers(true);
    expect(adviceArrived(56, r)).toMatch(/^Советник: Главный удар/); // озвучка включена — читается и ответ на вопрос кнопкой или из поля
    await disp.utterance('Штаб, подробнее', 2);
    expect(said.at(-1)).toMatch(/Резерв стоит ввести к вечеру/);
    d.suggestions = r.suggestions;
    await disp.utterance('Штаб, возьми второй приказ', 3);
    expect(d.takeSuggestion).toHaveBeenCalledWith(r.suggestions[1]);
    expect(said.at(-1)).toBe('Взял в проект: пятая ударная армия — наступать, Зелов.');
    await disp.utterance('Штаб, возьми приказ', 4);
    expect(said.at(-1)).toMatch(/^Какой приказ: первый — /);
  });
  it('«стоп», пока советник готовит, — и замолчать, и остановить советника', async () => {
    const d = staff({ advisorBusy: true });
    await mk().utterance('Штаб, стоп', 1);
    expect(d.stopAdvisor).toHaveBeenCalled();
    d.advisorBusy = false;
    await mk().utterance('Штаб, останови советника', 2);
    expect(said.at(-1)).toMatch(/советник сейчас ничего не готовит/);
  });
});

// ---------------------------------------------------------------- беседа с советником: диктовка и озвучка

describe('поле вопроса советнику голосом', () => {
  it('«запиши в вопрос …» пишет в поле, «отправь вопрос» отправляет и очищает, пустое поле — не отправляется', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, отправь вопрос', 1);
    expect(d.askAdvisor).not.toHaveBeenCalled();
    d.setAdvisorText = vi.fn((x: string) => { d.advisorText = x; });
    await disp.utterance('Штаб, запиши в вопрос: где лучше наступать завтра', 2);
    expect(d.advisorText).toBe('Где лучше наступать завтра');
    await disp.utterance('Штаб, допиши в вопрос советнику: и чем прикрыть фланг', 3);
    expect(d.advisorText).toBe('Где лучше наступать завтра и чем прикрыть фланг');
    await disp.utterance('Штаб, отправь вопрос', 4);
    expect(d.askAdvisor).toHaveBeenCalledWith('Где лучше наступать завтра и чем прикрыть фланг');
    expect(d.advisorText).toBe('');
    expect(said.at(-1)).toMatch(/^Передал вопрос советнику/);
  });
  it('«не читай ответы советника» / «читай ответы советника вслух» переключают озвучку', async () => {
    staff();
    const disp = mk();
    await disp.utterance('Штаб, не читай ответы советника', 1);
    expect(speakAnswersOn()).toBe(false);
    await disp.utterance('Штаб, читай ответы советника вслух', 2);
    expect(speakAnswersOn()).toBe(true);
  });
});

// ---------------------------------------------------------------- решение

describe('решение голосом', () => {
  it('диктовка полей: замысел, замысел противника, оценка, донесение — по названию и коротко', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, запиши в замысел: главный удар на Зелов, к исходу дня выйти к Мюнхебергу.', 1);
    expect(d.decision.intent).toBe('Главный удар на Зелов, к исходу дня выйти к Мюнхебергу.');
    expect(said.at(-1)).toBe('Записал в «Замысел».');
    await disp.utterance('Штаб, запиши в замысел противника: удержать высоты', 2);
    expect(d.decision.enemyIntent).toBe('Удержать высоты');
    expect(d.decision.intent).toMatch(/^Главный удар/);
    await disp.utterance('Штаб, запиши в оценку: противник держит высоты', 3);
    expect(d.decision.assessment).toBe('Противник держит высоты');
    await disp.utterance('Штаб, допиши в решение резерв — к вечеру', 4);
    expect(d.decision.intent).toMatch(/Мюнхебергу\. резерв к вечеру$/);
    await disp.utterance('Штаб, прочитай замысел', 5);
    expect(said.at(-1)).toMatch(/^Главный удар на Зелов/);
    expect(d.setTab).toHaveBeenCalledWith('decision');
  });
  it('«возьми с прошлого хода» — пустые поля; с названием поля — только его', async () => {
    const d = staff({ decision: { ...EMPTY, intent: 'Своё.' } });
    const disp = mk();
    await disp.utterance('Штаб, возьми с прошлого хода', 1);
    expect(d.decision).toMatchObject({ assessment: LAST.assessment, intent: 'Своё.', report: LAST.report });
    expect(said.at(-1)).toMatch(/^Взял с прошлого хода: оценку обстановки, замысел противника, риски, донесение\./);
    await disp.utterance('Штаб, возьми замысел с прошлого хода', 2);
    expect(d.decision.intent).toBe(LAST.intent);
  });
  it('черновик донесения по докладам; «что не готово?»', async () => {
    const d = staff({ drafts: { su_8gva: { formation: 'su_8gva', task: 'attack', target: null, targetText: '', at: null, note: '' } } });
    const disp = mk();
    await disp.utterance('Штаб, что не готово?', 1);
    expect(said.at(-1)).toMatch(/^Не готово: оценка обстановки, замысел, боевое донесение; нет цели у приказа: восьмая гвардейская армия\./);
    expect(said.at(-1)).toMatch(/«составь черновик донесения»/);
    await disp.utterance('Штаб, составь черновик донесения', 2);
    expect(d.decision.report).toMatch(/^К 05:00 18\.04: в строю \d+ объединений/);
    expect(d.decision.report).toMatch(/прорвала оборону у Зелова/);
    expect(said.at(-1)).toMatch(/^Черновик донесения составлен по докладам/);
    d.decision = { ...LAST };
    d.drafts = {};
    await disp.utterance('Штаб, что не готово', 3);
    expect(said.at(-1)).toMatch(/^Решение готово: приказов нет, распоряжений нет\./);
  });
  it('decisionMissing и draftReportText — без React', () => {
    expect(decisionMissing(EMPTY)).toEqual(['оценка обстановки', 'решение (замысел)', 'боевое донесение вышестоящему']);
    expect(draftReportText(view(), { ...EMPTY, intent: 'Удар.' })).toMatch(/Решение на 18\.04: Удар\.$/);
  });
  it('черновик донесения — укомплектованность от штата и от начала операции', () => {
    const unit = own[0];
    const t = draftReportText({ ...view(), own: [{ ...unit, status: 'active', strength: 0.97, manning: 0.42 }] } as never, EMPTY);
    expect(t).toContain('42 % от штата, 97 % от начала операции');
    const t2 = draftReportText({ ...view(), own: [{ ...unit, status: 'active', strength: 0.97, manning: null }] } as never, EMPTY);
    expect(t2).toContain('средняя укомплектованность 97 % от начала операции');
  });
});

// ---------------------------------------------------------------- тыл, переправы, резервы, полосы

describe('распоряжения голосом', () => {
  it('на уровне, где подвкладки нет, действия не переключают её и отвечают причиной', async () => {
    const subsOk = { units: true, rear: 'тыл ведут штабы фронта и армии', bridges: 'переправы наводят штабы с парками', reserves: 'в подчинении нет резервов', bounds: 'полосы — в «Пункте управления»' };
    const d = staff({ subsOk } as Partial<StaffDeps>);
    const disp = mk();
    await disp.utterance('Штаб, перенеси базу восьмой гвардейской в Зелов', 1);
    expect(said.at(-1)).toMatch(/«Тыл» на этом уровне нет: тыл ведут/);
    await disp.utterance('Штаб, приоритет подвоза восьмой гвардейской', 2);
    expect(said.at(-1)).toMatch(/«Тыл» на этом уровне нет/);
    await disp.utterance('Штаб, наведи переправу у Зелова', 3);
    expect(said.at(-1)).toMatch(/«Переправы» на этом уровне нет/);
    expect(d.acts).toHaveLength(0);
    expect(d.setSub).not.toHaveBeenCalled();
  });
  it('скрытая подвкладка: отмена ввода и намётка линии ничего не меняют', async () => {
    const subsOk = { units: true, rear: true, bridges: true, reserves: 'в подчинении нет резервов', bounds: 'полосы — в «Пункте управления»' };
    const d = staff({ subsOk } as Partial<StaffDeps>);
    const disp = mk();
    await disp.utterance('Штаб, предложи линию между восьмой гвардейской и пятой ударной', 1);
    expect(said.at(-1)).toMatch(/«Полосы» на этом уровне нет/);
    expect(d.setBounds).not.toHaveBeenCalled();
    d.acts = [{ key: 'commit:x', action: { kind: 'commit', side: 'su', formation: 'x', at: [0, 0], issuedAt: '' }, label: 'Ввод', text: '' }];
    await disp.utterance('Штаб, не вводи третью ударную', 2);
    expect(d.dropAct).not.toHaveBeenCalled();
  });
  it('переправа у места — проверка Worker; неисполнимое — текст проверки', async () => {
    let ok = true;
    const d = staff({}, () => (ok ? { ok: true, text: 'малая река; переправа будет готова ≈ 18.04 17:00' } : { ok: false, text: 'здесь нет реки — переправа не нужна' }));
    const disp = mk();
    await disp.utterance('Штаб, наведи переправу у Зелова', 1);
    expect(d.acts.map((a) => a.action.kind)).toEqual(['bridge']);
    expect(said.at(-1)).toBe('Переправа: малая река; переправа будет готова примерно восемнадцатого апреля семнадцать ноль-ноль.');
    ok = false;
    await disp.utterance('Штаб, наведи переправу у Мюнхеберга', 2);
    expect(d.acts).toHaveLength(1);
    expect(said.at(-1)).toBe('Не выйдет: здесь нет реки — переправа не нужна.');
  });
  it('база снабжения: по армии — ближайшая к ней база; приоритет подвоза', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, перенеси базу восьмой гвардейской в Зелов', 1);
    expect(d.acts[0].action).toMatchObject({ kind: 'base', base: 'base1', to: zelov.at });
    expect(said.at(-1)).toMatch(/^База «Костшин»: /);
    await disp.utterance('Штаб, приоритет подвоза восьмой гвардейской и пятой ударной', 2);
    expect(d.acts.find((a) => a.key === 'priority')?.action).toMatchObject({ kind: 'priority', formations: ['su_8gva', 'su_5ua'] });
  });
  it('резерв: ввести в районе места, «не вводи»', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, введи третью ударную в районе Зелова', 1);
    expect(d.commit).toHaveBeenCalledWith(expect.objectContaining({ id: 'su_3ua' }), zelov.at, zelov.title);
    expect(d.acts.map((a) => a.key)).toEqual(['commit:su_3ua']);
    await disp.utterance('Штаб, не вводи третью ударную', 2);
    expect(d.acts).toEqual([]);
  });
  it('полосы: «предложи линию между …» — линия на карте; «в распоряжение» — проверка', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, предложи линию между восьмой гвардейской и пятой ударной', 1);
    expect(d.bounds).toMatchObject({ front: 'su_1bf', a: 'su_8gva', b: 'su_5ua' });
    expect(d.bounds.pts.length).toBe(3);
    expect(said.at(-1)).toMatch(/скажите «в распоряжение»/);
    await disp.utterance('Штаб, в распоряжение', 2);
    expect(d.acts[0].action).toMatchObject({ kind: 'boundary', a: 'su_8gva', b: 'su_5ua' });
    await disp.utterance('Штаб, предложи линию между восьмой гвардейской и тринадцатой армией', 3);
    expect(said.at(-1)).toMatch(/одного фронта/);
  });
});

// ---------------------------------------------------------------- состояние, раздел, ложные перехваты

describe('когда нельзя', () => {
  it('раздел в фоне, расчёт хода, игра окончена — не исполняется, причина простыми словами', async () => {
    const d = staff({ busy: 'расчёт хода…' });
    await mk().utterance('Штаб, восьмой гвардейской наступать на Зелов', 1);
    expect(said.at(-1)).toMatch(/^Сейчас нельзя: считаю ход/);
    expect(d.drafts).toEqual({});
    d.busy = null;
    section = 'editor';
    expect(await act('command.order', { unit: 'восьмая гвардейская', task: 'наступать', place: 'Зелов' })).toMatch(/открыт другой раздел/);
    section = 'replay';
    d.view = view({ over: true });
    expect(await act('decision.missing')).toMatch(/игра окончена/);
  });
  it('нет игры — фразы командования не перехватываются (кроме понятных: причина)', () => {
    expect(parseStaff('восьмой гвардейской наступать на зелов', 'replay')).toBeNull();
    expect(parseStaff('подробнее о втором', 'replay')).toEqual({ say: expect.stringMatching(/игра не идёт/) });
  });
  it('вне «Переигровки» не перехватывается ничего', () => {
    staff();
    for (const q of ['восьмой гвардейской наступать на зелов', 'дай два варианта', 'что не готово', 'наведи переправу у зелова', 'выбираю второй'])
      expect(parsePhrase(q, 'knowledge'), q).toBeNull();
  });
  it('в игре обычные вопросы и похожие фразы — модели, а не действия', () => {
    cmd(view());
    staff({ plan: plan() });
    const QUESTIONS = [
      'где лучше наступать', 'как наступать на берлин', 'почему восьмая гвардейская не наступает', 'может ли восьмая гвардейская наступать на зелов',
      'какой вариант лучше', 'какие варианты есть у противника', 'дай совет', 'дай подумать', 'возьми на заметку', 'отмени это',
      'введи меня в курс дела', 'наведи порядок', 'перенеси на завтра', 'предложи что нибудь', 'указания будут', 'что если отойти',
      'что готово у противника', 'подробнее о противнике', 'советник', 'выбираю что делать', 'приоритет какой', 'стоит ли наступать',
      'когда восьмой гвардейской наступать', 'нужно ли удерживать зелов', 'как взять зелов',
    ];
    for (const q of QUESTIONS) expect(parsePhrase(q, 'replay'), q).toBeNull();
  });
  it('модель видит действия командования с параметрами (вызов модели проверяется реестром)', async () => {
    const d = staff();
    const model = vi.fn(async () => ({ say: 'Отдаю приказ.', call: { id: 'command.order', params: { unit: 'восьмая гвардейская', task: 'attack', place: 'Зелов' } } }));
    await mk(model).utterance('Штаб, пусть восьмая гвардейская возьмёт Зелов', 1);
    expect(model).toHaveBeenCalled();
    expect(d.drafts.su_8gva).toMatchObject({ task: 'attack', target: zelov.id });
  });
  it('примеры фраз полей — по-русски («запиши в оценку: …»)', () => {
    staff();
    expect(getAction('decision.assessment.write')!.say).toEqual(['штаб, запиши в оценку: …']);
    expect(getAction('decision.report.read')!.say).toEqual(['штаб, прочитай донесение']);
  });
  it('поля решения — только пока идёт игра в «Переигровке»', () => {
    staff();
    expect(parseDictation('запиши в замысел удар', 'запиши в замысел: удар')).toEqual({ id: 'decision.intent.write', params: { text: 'удар' } });
    expect(getAction('decision.intent.write')!.available()).toBe(true);
    section = 'maps';
    expect(getAction('decision.intent.write')!.available()).not.toBe(true);
  });
});

// ---------------------------------------------------------------- раунд 1 (по рецензии)

describe('раунд 1: «Куда?» снимается отказом и новой просьбой', () => {
  for (const no of ['Штаб, нет', 'Штаб, не надо', 'Штаб, отставить', 'Штаб, отмена']) {
    it(`«${no}» — приказ не отдан; потом название — не приказ`, async () => {
      const d = staff();
      const disp = mk();
      await disp.utterance('Штаб, пятой ударной наступать', 1);
      expect(said.at(-1)).toMatch(/Куда наступать\?/);
      t += 1000;
      await disp.utterance(no, 2);
      expect(said.at(-1)).toBe('Приказ не отдан: пятая ударная армия.');
      t += 1000;
      await disp.utterance('Штаб, Кюстрин', 3);
      expect(d.drafts.su_5ua).toBeUndefined();
    });
  }
  it('новая просьба — «Приказ не отдан», ответ после неё названием — не приказ', async () => {
    const d = staff();
    cmd(view());
    const spoken: string[] = [];
    setSpeaker((s) => { spoken.push(s); });
    const disp = mk();
    await disp.utterance('Штаб, восьмой гвардейской наступать', 1);
    t += 1000;
    await disp.utterance('Штаб, доложи обстановку', 2);
    expect([...spoken, ...said].join(' ')).toMatch(/Приказ не отдан: восьмая гвардейская армия\./);
    t += 1000;
    await disp.utterance('Штаб, Зелов', 3);
    expect(d.drafts.su_8gva).toBeUndefined();
    setSpeaker(null);
  });
  it('ответ названием — только сразу и не позже 30 с', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const d = staff();
      const disp = mk();
      await disp.utterance('Штаб, восьмой гвардейской наступать', 1);
      vi.setSystemTime(Date.now() + 31_000);
      disp.spoke();
      await disp.utterance('Зелов', 2);
      expect(d.drafts.su_8gva).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
});

describe('раунд 1: падежи в ответах', () => {
  it('nameCase: родительный, дательный, творительный — по названию соединения', () => {
    expect(nameCase('LVI танковый корпус', 'gen')).toBe('пятьдесят шестого танкового корпуса');
    expect(nameCase('Группа армий «Центр»', 'gen')).toBe('группы армий «Центр»');
    expect(nameCase('8-я гвардейская армия', 'ins')).toBe('восьмой гвардейской армией');
    expect(nameCase('5-я ударная армия', 'dat')).toBe('пятой ударной армии');
    expect(nameCase('1-я армия Войска Польского', 'dat')).toBe('первой армии Войска Польского');
    expect(nameCase('XXXII армейский корпус', 'ins')).toBe('тридцать вторым армейским корпусом');
    expect(nameCase('Что-то непонятное', 'gen')).toBe('Что-то непонятное');
  });
  it('приказ против противника — родительный; линия — творительный; «Куда наступать?»', async () => {
    const lvi = F.find((f) => f.name === 'LVI танковый корпус')!;
    const v = view({ intel: [...intel, { ...intel[0], id: lvi.id, name: lvi.name }] });
    const d = staff({ view: v });
    const disp = mk();
    await disp.utterance(`Штаб, восьмой гвардейской атаковать ${intel[1].name}`, 1);
    expect(said.at(-1)).toMatch(/^Приказ: восьмая гвардейская армия — наступать против группы армий «Центр»\./);
    await disp.utterance('Штаб, пятой ударной атаковать пятьдесят шестой танковый корпус', 2);
    expect(d.drafts.su_5ua?.target).toEqual({ formation: lvi.id });
    expect(said.at(-1)).toMatch(/наступать против пятьдесят шестого танкового корпуса\./);
    await disp.utterance('Штаб, предложи линию между восьмой гвардейской и пятой ударной', 3);
    expect(said.at(-1)).toMatch(/^Линия между восьмой гвардейской армией и пятой ударной армией намечена на карте/);
    await disp.utterance('Штаб, восьмой гвардейской удерживать Москву', 4);
    expect(said.at(-1)).not.toMatch(/Куда удерживать/);
    expect(said.at(-1)).toMatch(/Что удерживать\?/);
  });
  it('подсказка «что не готово» — дательный', async () => {
    staff({ decision: { ...LAST }, drafts: { su_8gva: { formation: 'su_8gva', task: 'attack', target: null, targetText: '', at: null, note: '' } } });
    await mk().utterance('Штаб, что не готово', 1);
    expect(said.at(-1)).toMatch(/«восьмой гвардейской армии наступать на ?…»/);
  });
});

describe('раунд 1: диктовка — поле по словам до двоеточия', () => {
  it('«запиши в замысел: противника сковать…» — в «Замысел»; «в замысел противника: …» — в него', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, запиши в замысел: противника сковать с фронта, главными силами обойти Зелов с севера.', 1);
    expect(d.decision.intent).toMatch(/^Противника сковать с фронта, главными силами обойти Зелов с севера/);
    expect(d.decision.enemyIntent).toBe('');
    await disp.utterance('Штаб, запиши в замысел противника: удержать высоты', 2);
    expect(d.decision.enemyIntent).toBe('Удержать высоты');
  });
});

describe('раунд 1: непустой проект — одна проверка', () => {
  it('продиктованный замысел (не перенесённый с прошлого хода) — «выбираю второй» спрашивает', async () => {
    const d = staff({ plan: plan(), decision: { ...EMPTY, intent: 'Своё.' } });
    await mk().utterance('Штаб, выбираю второй', 1);
    expect(d.applyPlan).not.toHaveBeenCalled();
    expect(said.at(-1)).toMatch(/^Заменить проект вариантом «Обход с севера»\?/);
  });
  it('перенесённое с прошлого хода — не «непустой»', () => {
    const base = { drafts: {}, acts: [] };
    expect(projectHas({ ...base, decision: { ...EMPTY, intent: LAST.intent, enemyIntent: LAST.enemyIntent, risks: LAST.risks } }, LAST)).toBe(false);
    expect(projectHas({ ...base, decision: { ...EMPTY, risks: 'Иное.' } }, LAST)).toBe(true);
    expect(projectHas({ ...base, decision: { ...EMPTY, request: 'Прошу линию.' } }, LAST)).toBe(true);
    expect(projectHas({ ...base, decision: { ...EMPTY, intent: 'Своё.' } }, null)).toBe(true);
  });
});

describe('раунд 1: обороты цели', () => {
  it('«любой ценой», «к утру», «в направлении», «через», «, указания: …», неизвестный хвост', async () => {
    const d = staff();
    const disp = mk();
    const berlin = P.find((p) => p.title === 'Берлин')!;
    const mb = place('Мюнхеберг');
    await disp.utterance('Штаб, восьмой гвардейской удержать Зелов любой ценой', 1);
    expect(d.drafts.su_8gva).toMatchObject({ task: 'hold', target: zelov.id });
    await disp.utterance('Штаб, тридцать третьей армии взять Зелов к утру', 2);
    expect(d.drafts.su_33a).toMatchObject({ task: 'attack', target: zelov.id, note: 'К утру' });
    await disp.utterance('Штаб, шестьдесят девятой армии наступать в направлении Мюнхеберга', 3);
    expect(d.drafts.su_69a).toMatchObject({ task: 'attack', target: mb.id });
    await disp.utterance('Штаб, пятой ударной наступать на Берлин через Зелов', 4);
    expect(d.drafts.su_5ua).toMatchObject({ task: 'attack', target: berlin.id, note: 'Через Зелов' });
    await disp.utterance('Штаб, сорок седьмой армии наступать на Зелов, указания: обойти с севера', 5);
    expect(d.drafts.su_47a).toMatchObject({ target: zelov.id, note: 'Обойти с севера' });
    await disp.utterance('Штаб, третьей ударной наступать на Зелов вдоль шоссе', 6);
    expect(d.drafts.su_3ua).toMatchObject({ target: zelov.id, note: 'Вдоль шоссе' });
    expect(said.join(' ')).not.toMatch(/Не нашёл/);
  });
  it('«войскам наступать…» — не переспрос про Войско Польское', () => {
    staff();
    expect(parsePhrase('войскам наступать на зелов', 'replay')).toBeNull();
    expect(parsePhrase('всем армиям наступать', 'replay')).toBeNull();
  });
});

describe('раунд 1: «покажи варианты» не готовит новые', () => {
  it('готовые — перечислить; новые — только «дай / подготовь / предложи»', async () => {
    const d = staff({ plan: plan() });
    const disp = mk();
    await disp.utterance('Штаб, покажи варианты', 1);
    expect(d.askPlan).not.toHaveBeenCalled();
    expect(said.at(-1)).toMatch(/^Готовы два варианта: первый — «Удар на Зелов», второй — «Обход с севера»\./);
    expect(d.openVariant).toHaveBeenCalled();
    await disp.utterance('Штаб, варианты', 2);
    expect(d.askPlan).not.toHaveBeenCalled();
    expect(parsePhrase('какие варианты', 'replay')).toEqual({ id: 'command.variants.list' });
    expect(parsePhrase('подготовь варианты', 'replay')).toEqual({ id: 'command.variants', params: {} });
  });
});

describe('раунд 1: поздний ответ советника', () => {
  it('вне «Переигровки» — без подсказок фраз, только где ответ', async () => {
    staff();
    const disp = mk();
    await disp.utterance('Штаб, дай два варианта', 1);
    await disp.utterance('Штаб, спроси советника: где лучше наступать?', 2);
    section = 'knowledge';
    expect(planArrived(plan())).toBe('Советник подготовил варианты. Они — в разделе «Переигровка».');
    const r: AdviceView = { ok: true, answer: 'Лучше на Зелов.', basis: [], unknowns: [], followUps: [], suggestions: [sug('8-я гвардейская армия', 'su_8gva')] };
    expect(adviceArrived(41, r)).toBe('Советник ответил. Ответ — в разделе «Переигровка».');
  });
  it('ответ, пришедший пока человек говорит, не снимается новой репликой (keep), но новая просьба к советнику его снимает', async () => {
    const sent: string[] = [];
    let now = 0;
    const gate = new SayGate((_id, text) => sent.push(text), () => now, () => false);
    gate.speech(true);
    gate.say(1, 'Ответ советника.', true);
    gate.say(2, 'Старый ответ.');
    gate.dropStale();
    gate.speech(false);
    gate.utterance();
    expect(sent).toEqual(['Ответ советника.']);
    // штаб: ответ советника — фраза keep; новая просьба к советнику снимает ждущую
    const spoken: { t: string; keep?: boolean }[] = [];
    const retracted: number[] = [];
    setSpeaker((s, o) => { spoken.push({ t: s, keep: o?.keep }); return 77; });
    setRetractor((id) => retracted.push(id));
    staff();
    const disp = mk();
    await disp.utterance('Штаб, спроси советника: где лучше наступать?', 1);
    adviceReady(41, { ok: true, answer: 'Лучше на Зелов.', basis: [], unknowns: [], followUps: [], suggestions: [] });
    expect(spoken.at(-1)).toEqual({ t: 'Советник: Лучше на Зелов.', keep: true });
    await disp.utterance('Штаб, спроси советника: а резервы?', 2);
    expect(retracted).toEqual([77]);
    setSpeaker(null); setRetractor(null);
  });
  it('announce с keep передаёт пометку в say', () => {
    const calls: unknown[] = [];
    const disp = new Dispatcher({ now: () => t, say: (s, o) => { calls.push([s, o]); return 1; }, section: () => section });
    disp.announce('Ответ.', { keep: true });
    expect(calls).toEqual([['Ответ.', { keep: true }]]);
  });
});

describe('раунд 1: указания и диктовка — как сказано', () => {
  it('«указания: …» сохраняют регистр, «ё» и знаки', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, восьмой гвардейской наступать на Зелов', 1);
    await disp.utterance('Штаб, указания: не ввязываться в бои за Зелов, обходить; ёлки', 2);
    expect(d.drafts.su_8gva.note).toBe('Не ввязываться в бои за Зелов, обходить; ёлки');
  });
});

describe('раунд 1: мелкие', () => {
  it('черновик поверх продиктованного донесения — вопрос', async () => {
    const d = staff({ decision: { ...EMPTY, report: 'Своё донесение.' } });
    await mk().utterance('Штаб, напиши донесение', 1);
    expect(said.at(-1)).toBe(`Заменить продиктованное донесение черновиком? ${YES_NO_SAY}`);
    expect(d.decision.report).toBe('Своё донесение.');
  });
  it('«очищен / очищена / очищены / очищено» — по роду поля', async () => {
    staff({ decision: { ...LAST } });
    const disp = mk();
    // непустое поле стирается после «да»
    await disp.utterance('Штаб, очисти замысел противника', 1);
    await disp.utterance('да', 11);
    expect(said.at(-1)).toBe('«Замысел противника» очищен.');
    await disp.utterance('Штаб, очисти оценку обстановки', 2);
    await disp.utterance('да', 12);
    expect(said.at(-1)).toBe('«Оценка обстановки» очищена.');
    await disp.utterance('Штаб, очисти риски', 3);
    await disp.utterance('да', 13);
    expect(said.at(-1)).toBe('«Риски» очищены.');
    await disp.utterance('Штаб, очисти донесение', 4);
    await disp.utterance('да', 14);
    expect(said.at(-1)).toBe('«Донесение» очищено.');
  });
  it('отменить переправу, приоритет, линию — голосом', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, наведи переправу у Зелова', 1);
    await disp.utterance('Штаб, приоритет подвоза восьмой гвардейской', 2);
    await disp.utterance('Штаб, предложи линию между восьмой гвардейской и пятой ударной', 3);
    await disp.utterance('Штаб, в распоряжение', 4);
    expect(d.acts.map((a) => a.action.kind).sort()).toEqual(['boundary', 'bridge', 'priority']);
    await disp.utterance('Штаб, отмени переправу у Зелова', 5);
    expect(said.at(-1)).toMatch(/^Отменено: переправа/);
    await disp.utterance('Штаб, отмени приоритет подвоза', 6);
    await disp.utterance('Штаб, отмени линию', 7);
    expect(d.acts).toEqual([]);
  });
  it('кнопка во время расчёта хода — причина словами', async () => {
    staff({ busy: 'расчёт хода…' });
    const reasons: string[] = [];
    await press('decision.draftReport', undefined, (r) => reasons.push(r));
    expect(reasons).toEqual(['Считаю ход — подождите, посредник доложит итоги.']);
  });
});

// ---------------------------------------------------------------- раунд 2 (по повторной рецензии)

describe('раунд 2: переспрос не съедает «Куда?»', () => {
  for (const again of ['Штаб, повтори', 'Штаб, что?', 'Штаб, не расслышал', 'Штаб, подожди']) {
    it(`«${again}» — вопрос остаётся, ответ местом принимается`, async () => {
      const d = staff();
      const disp = mk();
      await disp.utterance('Штаб, восьмой гвардейской наступать', 1);
      const asked = said.at(-1);
      t += 1000;
      await disp.utterance(again, 2);
      if (!/подожди/.test(again)) expect(said.at(-1)).toBe(asked);
      t += 1000;
      await disp.utterance('Штаб, Зелов', 3);
      expect(d.drafts.su_8gva).toMatchObject({ task: 'attack', target: zelov.id });
    });
  }
});

describe('раунд 2: «Приказ не отдан» — сразу, при снятии ожидания', () => {
  it('после диктовки — сразу, а не при следующей команде', async () => {
    staff();
    const spoken: string[] = [];
    setSpeaker((s) => { spoken.push(s); });
    const disp = mk();
    await disp.utterance('Штаб, восьмой гвардейской наступать', 1);
    t += 1000;
    await disp.utterance('Штаб, запиши в замысел: удар на Зелов', 2);
    expect(spoken).toEqual(['Приказ не отдан: восьмая гвардейская армия.']);
    t += 1000;
    await disp.utterance('Штаб, что не готово', 3);
    expect(spoken).toHaveLength(1);
    setSpeaker(null);
  });
  it('ожидание истекло — снимается молча', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      staff();
      const spoken: string[] = [];
      setSpeaker((s) => { spoken.push(s); });
      const disp = mk();
      await disp.utterance('Штаб, восьмой гвардейской наступать', 1);
      vi.setSystemTime(Date.now() + 31_000);
      await disp.utterance('Штаб, что не готово', 2);
      expect(spoken).toEqual([]);
      setSpeaker(null);
    } finally { vi.useRealTimers(); }
  });
});

describe('раунд 2: двоеточие внутри диктуемого текста', () => {
  it('название поля кончается у двоеточия — оно; иначе — как раньше, самое длинное', async () => {
    const d = staff();
    const disp = mk();
    await disp.utterance('Штаб, запиши в замысел главный удар: на Зелов', 1);
    expect(d.decision.intent).toBe('Главный удар: на Зелов');
    await disp.utterance('Штаб, запиши в замысел противника удержать высоты: любой ценой', 2);
    expect(d.decision.enemyIntent).toBe('Удержать высоты: любой ценой');
    await disp.utterance('Штаб, запиши в замысел: противника сковать', 3);
    expect(d.decision.intent).toBe('Противника сковать');
  });
});

describe('раунд 2: вопрос — не приказ', () => {
  it('«или нет», «как думаешь», «стоит ли», «можно ли», «?» — модели', () => {
    staff();
    for (const q of ['восьмой гвардейской наступать на берлин или нет', 'восьмой гвардейской наступать на зелов как думаешь',
      'восьмой гвардейской стоит ли наступать на зелов', 'восьмой гвардейской можно ли наступать на зелов', 'восьмой гвардейской наступать ли на зелов'])
      expect(parsePhrase(q, 'replay', q), q).toBeNull();
    expect(parsePhrase('восьмой гвардейской наступать на зелов', 'replay', 'Восьмой гвардейской наступать на Зелов?')).toBeNull();
    expect(parsePhrase('восьмой гвардейской наступать на зелов', 'replay', 'Восьмой гвардейской наступать на Зелов.')).toMatchObject({ id: 'command.order' });
  });
});

describe('раунд 2: отмена распоряжения — хвост проверяется', () => {
  it('непонятный хвост — не перехват; понятный — отмена', () => {
    staff();
    expect(parsePhrase('убери линию с карты', 'replay')).toBeNull();
    expect(parsePhrase('отмени переправу у меня в голове', 'replay')).toBeNull();
    expect(parsePhrase('отмени переправу у зелова', 'replay')).toMatchObject({ id: 'command.act.cancel', params: { kind: 'bridge', name: 'зелова' } });
    expect(parsePhrase('отмени линию между восьмой гвардейской и пятой ударной', 'replay')).toMatchObject({ id: 'command.act.cancel', params: { kind: 'boundary' } });
    expect(parsePhrase('отмени линию', 'replay')).toEqual({ id: 'command.act.cancel', params: { kind: 'boundary' } });
  });
});

// ---------------------------------------------------------------- подсветка исполненного голосом

describe('подсветка исполненного голосом', () => {
  beforeEach(() => flash(null));
  it('«восьмой гвардейской наступать на …» — рамка на приказе и метка на карте', async () => {
    staff();
    await mk().utterance('Штаб, восьмой гвардейской наступать на Зеловские высоты', 1);
    expect(flashState()).toMatchObject({ targets: ['[data-hl="order-su_8gva"]'], spots: [heights.at] });
  });
  it('приказ без цели («Куда?») — подсветки нет', async () => {
    staff();
    await mk().utterance('Штаб, восьмой гвардейской наступать', 1);
    expect(flashState()).toBeNull();
  });
  it('«выбираю первый» — рамка на варианте', async () => {
    staff({ plan: plan(), decision: { ...EMPTY }, drafts: {}, acts: [] });
    await mk().utterance('Штаб, выбираю первый', 1);
    expect(flashState()?.targets).toEqual(['[data-hl="variant-1"]']);
  });
  it('поле решения диктовкой — рамка на поле', async () => {
    staff();
    await mk().utterance('Штаб, запиши в замысел: главный удар на Зелов', 1);
    expect(flashState()?.targets).toEqual(['[data-hl="field-intent"]']);
  });
  it('то же кнопкой (press) — без рамки', async () => {
    staff({ plan: plan() });
    await press('command.variant.pick', { n: 1 }, () => {});
    expect(flashState()).toBeNull();
  });
});

describe('разговор с командующим голосом', () => {
  it('«спроси командующего …» и вопросы подсказок — пока вкладка открыта; закрыта — причина', async () => {
    expect(parseStaff('спроси командующего почему так решил', 'replay')).toEqual({ say: expect.stringMatching(/вкладк[ауи] «Командующий»/) });
    expect(parseStaff('почему так решил', 'replay')).toBeNull();
    const asked: string[] = [];
    const get = () => ({ name: 'Жуков', ask: (q: string) => { asked.push(q); return 'Потому что.'; } });
    offs.push(register(commanderAction(get)), () => releaseCommander(get));
    expect(parseStaff('спроси командующего почему так решил', 'replay')).toEqual({ id: 'commander.ask', params: { question: 'почему так решил' } });
    expect(parseStaff('почему так решил', 'replay')).toEqual({ id: 'commander.ask', params: { question: 'почему так решил' } });
    expect(parseStaff('как оцениваешь положение', 'replay')).toMatchObject({ id: 'commander.ask' });
    expect(await act('commander.ask', { question: 'почему так решил' })).toBe('Потому что.');
    expect(asked).toEqual(['почему так решил']);
    section = 'maps';
    expect(await act('commander.ask', { question: 'x' })).toMatch(/другой раздел|переигровк/);
  });
});

describe('составить заново голосом', () => {
  it('«составь заново <поле>[ советником]» — замена с подтверждением', () => {
    staff();
    expect(parseStaff('составь заново оценку обстановки', 'replay')).toEqual({ id: 'decision.compose.replace', params: { field: 'assessment' } });
    expect(parseStaff('составь риски заново', 'replay')).toEqual({ id: 'decision.compose.replace', params: { field: 'risks' } });
    expect(parseStaff('составь заново риски советником', 'replay')).toEqual({ id: 'decision.compose.replace', params: { field: 'risks', advisor: true } });
    expect(getAction('decision.compose.replace')!.confirm!({ field: 'assessment' })).toBe('Составить оценку обстановки заново? Текст будет заменён.');
  });
  it('составленное по обстановке (не правленое) — не «непустой» проект', () => {
    const base = { drafts: {}, acts: [] };
    const d = { ...EMPTY, assessment: 'Оценка.', report: 'Донесение.', risks: 'Свои риски.' };
    expect(projectHas({ ...base, decision: d, auto: ['assessment', 'report', 'risks'] }, null)).toBe(false);
    expect(projectHas({ ...base, decision: d, auto: ['assessment', 'report'] }, null)).toBe(true);
  });
});

describe('пункт ниже Ставки: проект — по решению штаба пункта и его прошлому решению', () => {
  const ARMY: HumanDecision = { ...EMPTY, intent: 'Армия: удар на Зелов.', enemyIntent: 'Держит высоты.', risks: 'Фланг.' };
  it('правленое решение штаба пункта — принятие варианта спрашивает', async () => {
    staff({ plan: plan(), decision: { ...ARMY, intent: 'Правлено.' }, auto: ['assessment', 'report'], prevDecision: ARMY } as never);
    expect(getAction('command.variant.pick')!.check!({ n: 2 })).toMatch(/^В проекте уже есть решение/);
    expect(parseStaff('выбираю второй', 'replay')).toMatchObject({ id: 'command.variant.replace' });
  });
  it('перенесённое из прошлого решения штаба (не Ставки) и составленное — не «непустой»', () => {
    staff({ plan: plan(), decision: { ...ARMY, assessment: 'Оценка.', report: 'Донесение.' }, auto: ['assessment', 'report'], prevDecision: ARMY } as never);
    expect(getAction('command.variant.pick')!.check!({ n: 2 })).toBe(true);
    expect(parseStaff('выбираю второй', 'replay')).toMatchObject({ id: 'command.variant.pick' });
  });
});

describe('ходатайство голосом', () => {
  const NB = { show: true, who: 'rules' as const, why: 'Рассматривает Ставка на этом ходу по правилу.', neighbours: [{ id: 'su_1uf', name: '1-й Украинский фронт' }, { id: 'su_2bf', name: '2-й Белорусский фронт' }] };
  it('фразы: сосед, пункт в линию, очистить', () => {
    staff({ petition: NB } as never);
    expect(parseStaff('ходатайство о линии с первым украинским фронтом', 'replay')).toMatchObject({ id: 'decision.petition.neighbour', params: { name: 'первым украинским фронтом' } });
    expect(parseStaff('добавь в ходатайство Котбус', 'replay')).toEqual({ id: 'decision.petition.point', params: { place: 'Котбус' } });
    expect(parseStaff('очисти ходатайство', 'replay')).toEqual({ id: 'decision.petition.clear' });
  });
  it('сосед по названию, пункты — точки в конец линии, очистить', async () => {
    const d = staff({ petition: NB } as never);
    expect(await act('decision.petition.neighbour', { name: 'первым украинским фронтом' })).toMatch(/1-й Украинский фронт/);
    expect(d.decision.petition).toEqual({ neighbour: 'su_1uf', line: [], note: '' });
    expect(await act('decision.petition.point', { place: 'Котбус' })).toMatch(/Котбус/);
    expect(await act('decision.petition.point', { place: 'Зелов (' })).toMatch(/точек — две/);
    expect(d.decision.petition!.line).toEqual([P.find((p) => p.title.startsWith('Котбус'))!.at, zelov.at]);
    expect(await act('decision.petition.clear')).toMatch(/очищено/);
    expect(d.decision.petition).toBeUndefined();
  });
  it('где не действует — недоступно с пояснением', () => {
    staff({ petition: { show: false, why: 'Ставку ведёте вы сами: линию задайте директивой.', neighbours: [] } } as never);
    expect(getAction('decision.petition.neighbour')!.available()).toBe('Ставку ведёте вы сами: линию задайте директивой.');
    expect(getAction('decision.petition.point')!.available()).toMatch(/^Ставку ведёте/);
  });
});

describe('«Варианты советника» — по правилам и с правкой', () => {
  it('«принимаю второй и поправлю» — принять с правкой', async () => {
    const d = staff({ plan: plan() });
    expect(parseStaff('принимаю второй и поправлю', 'replay')).toEqual({ id: 'command.variant.pick', params: { n: 2, edit: true } });
    await act('command.variant.pick', { n: 2, edit: true });
    expect(d.applyPlan).toHaveBeenLastCalledWith(1, false, true);
  });
  it('без модели: на агентной модели — варианты по правилам, на нынешней — недоступно с причиной', () => {
    staff({ advisorReady: false, view: view({ engine: 'agents', command: { mode: 'agents', hqs: {} } as never }) } as never);
    expect(getAction('command.variants')!.available()).toBe(true);
    offs.forEach((o) => o()); offs = [];
    staff({ advisorReady: false } as never);
    expect(getAction('command.variants')!.available()).toBe('советник не на связи; варианты по правилам — в игре на агентной модели');
  });
});
