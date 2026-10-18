// «Командование» голосом — ход с подтверждением, доклад посредника (голосом посредника), штаб противника не ответил,
// конец игры, разбор операции и сохранение файлов: действия с поддельным состоянием (как в CommandView), разбор фраз
// без модели и ложные перехваты.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameRecord, IntelReport, UnitReport } from '@def-ops/sim';
import type { AiTurn } from '@def-ops/staff-service/live';
import type { HumanDecision, PlanVariantView, TurnView } from '../src/sim/game-protocol';
import { getAction, markVoice, parsePhrase, register, setProposer, setSpeaker, type Action, type SpeakOpts } from '../src/voice/registry';
import { CONFIRM_MS, Dispatcher } from '../src/voice/dispatch';
import { setSectionSource } from '../src/voice/actions/command';
import { releaseStaff, staffActions, type OrderDraft, type PlanState, type StaffAct, type StaffDeps } from '../src/voice/actions/staff';
import { blockedArrived, releaseTurn, turnActions, turnMissing, type ReviewCtl, type TurnDeps } from '../src/voice/actions/turn';
import { announceTurn, lastUmpire, resetUmpire, UMPIRE_SYSTEM, umpireReport } from '../src/voice/umpire';
import { saveFile, setSaver } from '../src/voice/files';
import { releaseScreen, screenActions, type ScreenDeps } from '../src/voice/actions/screen';
import { stopReading } from '../src/voice/dictation';

// ---------------------------------------------------------------- обстановка

const unit = (id: string, name: string, over: Partial<UnitReport> = {}): UnitReport => ({
  id, name, parent: 'su_1bf', echelon: 'army', status: 'active', at: [14.4, 52.55], place: 'у Зелова', posture: 'наступает',
  task: 'наступать', target: 'на Берлин', orderSource: 'script', personnel: 75_400, tanks: 120, guns: 900, strength: 0.86, ammo: 1.4, fuel: 0.9,
  fatigue: 0.3, cutOff: false, movedKm: 6, combats: [], pending: [], ...over,
} as UnitReport);
const OWN = [unit('su_8gva', '8-я гвардейская армия'), unit('su_5ua', '5-я ударная армия'), unit('su_69a', '69-я армия')];
const INTEL: IntelReport[] = [{ id: 'de_56tk', name: 'LVI танковый корпус', at: [14.3, 52.5], place: 'у Мюнхеберга', posture: 'обороняется', estimate: 'до 20 тыс. чел.', fresh: true, nearest: { name: '8-я гвардейская армия', km: 6 } }];
const PLACES = [{ id: 'Seelow', title: 'Зелов (Seelow)', at: [14.38, 52.53] as [number, number] }, { id: 'Muencheberg', title: 'Мюнхеберг (Müncheberg)', at: [14.14, 52.5] as [number, number] }];
const EMPTY: HumanDecision = { assessment: '', enemyIntent: '', intent: '', report: '', risks: '' };
const READY: HumanDecision = { assessment: 'Противник держит высоты.', enemyIntent: '', intent: 'Главный удар — на Зелов.', report: 'Войска ведут бой за высоты.', risks: '' };
const view = (over: Partial<TurnView> = {}): TurnView => ({
  scenario: 'berlin-1945-tasks', scenarioName: 'Берлинская операция', rules: 'x', seed: 1, start: '1945-04-16T05:00', end: '1945-05-08T05:00',
  takeover: '1945-04-16T05:00', time: '1945-04-17T05:00', turnHours: 24, turn: 2, over: false, outcome: null,
  victory: 'Знамя Победы над рейхстагом', deadline: '1945-05-08T05:00', strength: 0.91, strengthBelow: 0.5,
  human: { id: 'su', name: 'СССР' }, ai: { id: 'de', name: 'Германия' }, terms: {} as TurnView['terms'],
  groups: [{ id: 'su_1bf', name: '1-й Белорусский фронт' }], own: OWN, intel: INTEL,
  events: ['8-я гвардейская армия прорвала первую полосу обороны у Зелова и продвинулась на 6 км.', '5-я ударная армия ведёт бой за Леччин.', 'Переправа у Кюстрина действует.'],
  places: PLACES, delays: { army: 6 }, detectKm: 15,
  goals: [{ title: 'Зееловские высоты взяты: прорыв второй полосы', historical: '1945-04-17T18:00', simulated: '1945-04-17T03:00', days: 0, at: '1945-04-17T03:00', place: [14.4, 52.55] },
    { title: 'Окружение Берлина', historical: '1945-04-25T12:00', simulated: null, days: null, at: null, place: null }],
  journal: [], doc: {} as TurnView['doc'], bases: [], priority: [], priorityMax: 3, supplyHours: {}, rangeHours: 24, bridges: [], parks: 2,
  lastDecision: null, sectors: [], boundaries: [], groupOf: {}, armies: [], reserveGroups: [],
  ...over,
} as TurnView);
const prev = view({ time: '1945-04-16T05:00', turn: 1, events: [], goals: view().goals.map((g) => ({ ...g, simulated: null, at: null })), strength: 0.95 });
const RECORD = { version: 1, scenario: 'berlin-1945-tasks', takeover: '1945-04-16T05:00', turns: [{ time: '1945-04-16T05:00', orders: [], actions: [],
  umpireNote: { ok: true, assessment: 'Бои за высоты тяжёлые: оборона подготовлена, взаимодействие с артиллерией налажено плохо.', issues: [], engagements: 3, refs: [] },
  umpire: [{ factor: 'terrain', mult: 0.85, reason: 'крутые склоны высот', formations: ['su_8gva'], basis: [] }] }] } as unknown as GameRecord;
const AI_TURN = { time: '1945-04-16T05:00', model: 'fake', ok: true, applied: [{ formation: 'LVI танковый корпус', given: { formation: 'de_56tk', task: 'hold', area: 'Зелов' }, target: 'Зелов', order: {} }],
  orders: [], issues: [], decision: { assessment: 'Русские прорвали первую полосу.', enemyIntent: 'Выйти к Берлину.', intent: 'Удержать вторую полосу у Зелова.', requests: [], risks: ['прорыв на Мюнхеберг'], orders: [] } } as unknown as AiTurn;

// ---------------------------------------------------------------- поддельное состояние

let offs: (() => void)[] = [];
let said: { text: string; role?: string; keep?: boolean }[] = [];
let section = 'replay';
let t = 1_000_000;
const reg = (list: Action[]) => offs.push(...list.map(register));
const texts = () => said.map((x) => x.text);
const last = () => said.at(-1)?.text ?? '';
let disp: Dispatcher;

function staff(d: Partial<StaffDeps> & { view: TurnView }): StaffDeps {
  const s = {
    busy: null, setTab: vi.fn(), setSub: vi.fn(), goTo: vi.fn(), select: vi.fn(), plan: null, planN: 2, askPlan: vi.fn(() => 7), stopAdvisor: vi.fn(),
    openVariant: vi.fn(), applyPlan: vi.fn(async () => 'Вариант принят.'), advisorBusy: false, askAdvisor: vi.fn(() => 1), suggestions: [], takeSuggestion: vi.fn(),
    decision: { ...EMPTY }, setDecision: vi.fn(), drafts: {}, setDraft: vi.fn(), acts: [], addAct: vi.fn(), dropAct: vi.fn(), commit: vi.fn(),
    bounds: { front: '', a: '', b: '', pts: [] }, setBounds: vi.fn(), ...d,
  } as unknown as StaffDeps;
  s.setDraft = vi.fn((id: string, x: OrderDraft | null) => { const n = { ...s.drafts }; if (x) n[id] = x; else delete n[id]; s.drafts = n; });
  const get = () => s;
  reg(staffActions(get));
  offs.push(() => releaseStaff(get));
  return s;
}

type TD = TurnDeps & { sendTurn: ReturnType<typeof vi.fn> };
function turn(over: Partial<TurnDeps> = {}, st?: StaffDeps): TD {
  const d = {
    view: view(), busy: null, blocked: null, enemy: 'llm', ai: { state: 'off' }, aiTurns: [], record: RECORD,
    drafts: {}, acts: [], decision: { ...READY }, plan: null, planN: 2,
    sendTurn: vi.fn(), retryAi: vi.fn(), skipAi: vi.fn(), setTab: vi.fn(), setUmpirePart: vi.fn(), showMissing: vi.fn(), notice: vi.fn(),
    review: { open: false, ctl: null, show: vi.fn() },
    journal: () => ({ name: 'berlin-журнал.md', text: '# Журнал' }), gameRecord: () => ({ name: 'berlin-игра.json', text: '{}' }),
    ...over,
  } as unknown as TD;
  // проект хода — общий с действиями штабной работы (как в CommandView)
  if (st) Object.defineProperties(d, { drafts: { get: () => st.drafts }, acts: { get: () => st.acts }, decision: { get: () => st.decision }, plan: { get: () => st.plan } });
  const get = () => d;
  reg(turnActions(get));
  offs.push(() => releaseTurn(get));
  return d;
}
const order = (formation: string, task: OrderDraft['task'], target: OrderDraft['target'] = 'Seelow'): OrderDraft => ({ formation, task, target, targetText: target ? 'Зелов' : '', at: target ? [14.38, 52.53] : null, note: '' });
const act1 = (key: string): StaffAct => ({ key, action: { kind: 'priority', side: 'su', formations: ['su_8gva'], issuedAt: '' }, label: 'Приоритет подвоза', text: 'ok' });

beforeEach(() => {
  offs = []; said = []; section = 'replay'; t = 1_000_000;
  setSectionSource(() => section);
  disp = new Dispatcher({ now: () => t, say: (s, o) => { said.push({ text: s, ...o }); }, section: () => section });
  setSpeaker((text: string, o?: SpeakOpts) => disp.announce(text, o));
  setProposer((text, id, params) => disp.propose(text, id, params));
  offs.push(register({ id: 'shell.open', section: 'global', title: '', describe: '', available: () => true, run: async () => undefined }));
  resetUmpire();
});
afterEach(() => { offs.forEach((o) => o()); stopReading(); setSpeaker(null); setProposer(null); setSaver(null); vi.useRealTimers(); });

// ---------------------------------------------------------------- ход

describe('ход голосом: «проводи ход»', () => {
  it('решение готово — подтверждение со словами (приказов, распоряжений), «да» отправляет ход один раз', async () => {
    const d = turn({ drafts: { su_8gva: order('su_8gva', 'attack'), su_5ua: order('su_5ua', 'hold') }, acts: [act1('priority')] });
    expect(await disp.utterance('Штаб, проводи ход', 1)).toBe('done');
    expect(last()).toMatch(/^Провожу ход: решение готово, приказов два, распоряжений одно\. Скажите «да».*Жду ответа\.$/);
    expect(d.sendTurn).not.toHaveBeenCalled();
    expect(disp.pending?.action).toBe('command.turn');
    expect(await disp.utterance('да', 2)).toBe('done');
    expect(d.sendTurn).toHaveBeenCalledTimes(1);
    expect(last()).toMatch(/^Считаю ход/);
  });
  it('без приказов и распоряжений — так и сказано, без цифр', async () => {
    turn();
    await disp.utterance('Штаб, сделай ход', 1);
    expect(last()).toMatch(/^Провожу ход: решение готово, новых приказов нет, распоряжений нет\./);
    expect(last()).not.toMatch(/\d/);
  });
  it('«можно проводить ход», «давай ход», «сделай ход», «проведи ход» — действие хода, а не «не предусматривает»', () => {
    turn();
    for (const s of ['можно проводить ход', 'давай ход', 'сделай ход', 'проведи ход', 'проводи ход', 'давай следующий ход', 'можно делать ход'])
      expect(parsePhrase(s, 'replay'), s).toEqual({ id: 'command.turn' });
  });
  it('похожие фразы и вопросы — не ход (их разбирает модель)', () => {
    turn();
    for (const s of ['когда проводить ход', 'как сделать ход', 'что будет если сделать ход', 'ход конем', 'какой сейчас ход', 'проводи меня',
      'ход противника', 'сделай ход за противника', 'можно ли проводить ход', 'проводить ход или нет', 'ход'])
      expect(parsePhrase(s, 'replay'), s).toBeNull();
    expect(parsePhrase('проводи ход', 'knowledge')).toBeNull();
  });
  it('«да» после 15 с — ход не проводится; новая просьба — прежнее отменено, «да» потом ничего не проводит', async () => {
    const d = turn();
    await disp.utterance('Штаб, проводи ход', 1);
    t += CONFIRM_MS + 1000;
    await disp.utterance('да', 2);
    expect(d.sendTurn).not.toHaveBeenCalled();
    await disp.utterance('Штаб, проводи ход', 3);
    await disp.utterance('Штаб, доложи обстановку', 4);
    expect(texts()).toContain('Прежнее отменено.');
    await disp.utterance('Штаб, да', 5);
    expect(d.sendTurn).not.toHaveBeenCalled();
  });
  it('решение не готово — что именно и предложение: варианты советника («да» — просит варианты)', async () => {
    const st = staff({ view: view(), decision: { ...EMPTY } });
    const d = turn({}, st);
    await disp.utterance('Штаб, проводи ход', 1);
    expect(last()).toMatch(/^Ход проводить рано: не готово — оценка обстановки, решение \(замысел\), боевое донесение вышестоящему\. Попросить у советника варианты решения\? Скажите «да»/);
    expect(d.sendTurn).not.toHaveBeenCalled();
    await disp.utterance('да', 2);
    expect(st.askPlan).toHaveBeenCalledWith(2);
  });
  it('варианты готовы — «составить решение по варианту?»; «да» принимает первый', async () => {
    const v: PlanVariantView = { title: 'Удар на Зелов', idea: '', decision: READY, orders: [], acts: [] } as unknown as PlanVariantView;
    const st = staff({ view: view(), decision: { ...EMPTY }, plan: { id: 7, time: '1945-04-17T05:00', count: 1, variants: [v], progress: '', done: true } as PlanState });
    turn({}, st);
    await disp.utterance('Штаб, проводи ход', 1);
    expect(last()).toMatch(/Составить решение по варианту «Удар на Зелов»\?/);
    await disp.utterance('да', 2);
    expect(st.applyPlan).toHaveBeenCalledWith(0, false);
  });
  it('не хватает только донесения — «составить черновик донесения?»', async () => {
    const st = staff({ view: view(), decision: { ...READY, report: '' } });
    turn({}, st);
    await disp.utterance('Штаб, проводи ход', 1);
    expect(last()).toMatch(/^Ход проводить рано: не готово — боевое донесение вышестоящему\. Составить черновик донесения\?/);
    await disp.utterance('да', 2);
    expect(st.setDecision).toHaveBeenCalledWith(expect.objectContaining({ report: expect.stringContaining('в строю') }));
  });
  it('у приказа нет цели — штаб спрашивает «Куда наступать?», ответ названием дополняет приказ', async () => {
    const st = staff({ view: view(), decision: { ...READY }, drafts: { su_8gva: order('su_8gva', 'attack', null) } });
    const d = turn({}, st);
    await disp.utterance('Штаб, проводи ход', 1);
    expect(last()).toMatch(/^Ход проводить рано: у приказа нет цели — восьмая гвардейская армия — наступать\. Куда наступать\?/);
    expect(d.sendTurn).not.toHaveBeenCalled();
    await disp.utterance('Штаб, Зелов', 2);
    expect(st.drafts.su_8gva).toMatchObject({ target: 'Seelow' });
  });
  it('во время расчёта — «Считаю ход», кнопкой и голосом — причина', async () => {
    const d = turn({ busy: 'расчёт хода…' });
    await disp.utterance('Штаб, проводи ход', 1);
    expect(last()).toMatch(/^Сейчас нельзя: считаю ход/);
    expect(getAction('command.turn')!.available()).toMatch(/^считаю ход/);
    expect(d.sendTurn).not.toHaveBeenCalled();
  });
  it('кнопка — то же действие: без вопроса, не готово — показывает, чего нет', async () => {
    const d = turn({ decision: { ...EMPTY } });
    await getAction('command.turn')!.run({});
    expect(d.sendTurn).not.toHaveBeenCalled();
    expect(d.showMissing).toHaveBeenCalledWith(expect.objectContaining({ decision: ['оценка обстановки', 'решение (замысел)', 'боевое донесение вышестоящему'] }));
    d.decision = { ...READY };
    await getAction('command.turn')!.run({});
    expect(d.sendTurn).toHaveBeenCalledTimes(1);
  });
  it('turnMissing — цели и поля решения', () => {
    expect(turnMissing({ drafts: { a: order('a', 'attack', null), b: order('b', 'hold', null) }, decision: { ...READY } })).toEqual({ targets: ['a'], decision: [] });
  });
  it('модель вызывает ход — тоже через подтверждение', async () => {
    const d = turn();
    const m = new Dispatcher({ now: () => t, say: (s) => { said.push({ text: s }); }, section: () => section,
      model: async () => ({ say: 'Провожу.', call: { id: 'command.turn', params: {} } }) });
    await m.utterance('Штаб, ну давай уже дальше двигаться', 1);
    expect(d.sendTurn).not.toHaveBeenCalled();
    expect(last()).toMatch(/^Провожу ход: решение готово/);
  });
});

describe('штаб противника не дал решения', () => {
  it('штаб говорит, что можно; «повтори запрос» и «ход без его приказов» — действия', async () => {
    markVoice();
    const d = turn({ blocked: 'нет связи с LM Studio' });
    blockedArrived('нет связи с LM Studio');
    expect(last()).toMatch(/^Штаб противника не дал решения: нет связи с моделью\. Скажите «повтори запрос» или «ход без его приказов»\.$/);
    expect(parsePhrase('повтори запрос', 'replay')).toEqual({ id: 'command.ai.retry' });
    expect(parsePhrase('ход без его приказов', 'replay')).toEqual({ id: 'command.ai.skip' });
    expect(parsePhrase('ход без приказов противника', 'replay')).toEqual({ id: 'command.ai.skip' });
    await disp.utterance('Штаб, повтори запрос', 1);
    expect(d.retryAi).toHaveBeenCalled();
    d.blocked = 'x';
    await disp.utterance('Штаб, ход без его приказов', 2);
    expect(d.skipAi).toHaveBeenCalled();
  });
  it('штаб противника ответил — «повтори запрос» недоступно с причиной', () => {
    turn();
    expect(getAction('command.ai.retry')!.available()).toMatch(/штаб противника/);
  });
});

// ---------------------------------------------------------------- посредник

const sentences = (s: string) => s.match(/[^.!?…]+[.!?…]+/g)?.length ?? 0;

describe('доклад посредника по правилам', () => {
  it('3–5 фраз: что изменилось, главные события, продвижение к целям; без цифр', () => {
    const r = umpireReport(view(), RECORD, { state: 'off' }, prev);
    expect(sentences(r)).toBeGreaterThanOrEqual(3);
    expect(sentences(r)).toBeLessThanOrEqual(5);
    expect(r).not.toMatch(/\d/);
    expect(r).toMatch(/восьмая гвардейская армия прорвала/i);
    expect(r).toMatch(/Достигнуто: Зееловские высоты взяты/);
    expect(r).toMatch(/девяносто один процент/);
  });
  it('нет событий и целей — всё равно 3 фразы, честно', () => {
    const r = umpireReport(view({ events: [], goals: [] }), null, { state: 'off' }, prev);
    expect(sentences(r)).toBeGreaterThanOrEqual(3);
    expect(r).toMatch(/существенных событий нет/i);
  });
  it('поправки посредника в ходе — одной фразой', () => {
    expect(umpireReport(view(), RECORD, { state: 'off' }, prev)).toMatch(/Поправка посредника: крутые склоны высот\./);
  });
  it('конец игры — исход первой фразой', () => {
    const r = umpireReport(view({ over: true, outcome: { result: 'victory', text: 'Знамя Победы над рейхстагом 30 апреля.', at: null } }), RECORD, { state: 'off' }, prev);
    expect(r).toMatch(/^Игра окончена: победа\. Знамя Победы над рейхстагом тридцатого апреля\./);
    expect(sentences(r)).toBeLessThanOrEqual(5);
  });
});

describe('доклад посредника после хода — голосом посредника', () => {
  it('без модели — по правилам, роль umpire; затем штаб — одной фразой, если голосом пользовались', async () => {
    markVoice();
    await announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' } });
    const ump = said.find((x) => x.role === 'umpire')!;
    expect(ump.text).toBe(umpireReport(view(), RECORD, { state: 'off' }, prev));
    expect(ump.keep).toBe(true);
    expect(said.at(-1)).toMatchObject({ text: 'Решение на следующий ход: скажите «дай варианты» или «доложи обстановку».' });
    expect(said.at(-1)!.role).toBeUndefined();
  });
  it('голосом давно не пользовались — только доклад посредника, без подсказки штаба', async () => {
    markVoice(Date.now() - 10 * 60_000);
    await announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' } });
    expect(said).toHaveLength(1);
    expect(said[0].role).toBe('umpire');
  });
  it('с моделью — её текст (3–5 фраз, числа словами); системный текст — от лица посредника', async () => {
    const model = vi.fn(async () => 'Ход прошёл успешно. 8-я гв. армия прорвала оборону у Зелова. До окружения Берлина ещё далеко. Противник подтягивает резервы.');
    await announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' }, model });
    expect(model).toHaveBeenCalledWith(UMPIRE_SYSTEM, expect.stringContaining('прорвала первую полосу'), expect.anything());
    expect(UMPIRE_SYSTEM).toMatch(/посредник/i);
    const ump = said.find((x) => x.role === 'umpire')!;
    expect(ump.text).toMatch(/^Ход прошёл успешно\. Восьмая гвардейская армия прорвала оборону у Зелова\./);
    expect(ump.text).not.toMatch(/\d/);
  });
  it('модель недоступна или ответила одной фразой — по правилам', async () => {
    await announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' }, model: async () => { throw new Error('нет связи'); } });
    expect(said[0]).toMatchObject({ role: 'umpire', text: umpireReport(view(), RECORD, { state: 'off' }, prev) });
    said = [];
    await announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' }, model: async () => 'Хорошо.' });
    expect(said[0].text).toBe(umpireReport(view(), RECORD, { state: 'off' }, prev));
  });
  it('модель ответила поздно, а ход уже новый — старый доклад не звучит', async () => {
    let release!: (s: string) => void;
    const slow = () => new Promise<string>((r) => { release = r; });
    const p1 = announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' }, model: slow });
    const v3 = view({ time: '1945-04-18T05:00', turn: 3, events: ['Третий ход: бои за Мюнхеберг.'] });
    const p2 = announceTurn({ view: v3, prev: view(), record: RECORD, ai: { state: 'off' } });
    await p2;
    release('Старый доклад. Он устарел. Совсем.');
    await p1;
    expect(texts().join(' ')).not.toMatch(/Старый доклад/);
    expect(said.filter((x) => x.role === 'umpire')).toHaveLength(1);
  });
  it('раздел «Переигровка» в фоне — коротко, где доклад; «повтори доклад» там — целиком', async () => {
    section = 'knowledge';
    await announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' } });
    expect(said[0]).toMatchObject({ role: 'umpire', text: 'Ход посчитан. Доклад посредника — в разделе «Переигровка»: скажите «повтори доклад».' });
    section = 'replay';
    turn();
    said = [];
    await disp.utterance('Штаб, повтори доклад', 1);
    expect(said[0]).toMatchObject({ role: 'umpire', text: lastUmpire() });
  });
  it('«повтори» после доклада — голосом посредника; «стоп» его обрывает', async () => {
    const stop = vi.fn();
    disp = new Dispatcher({ now: () => t, say: (s, o) => { said.push({ text: s, ...o }); }, section: () => section, stop });
    setSpeaker((text: string, o?: SpeakOpts) => disp.announce(text, o));
    markVoice(Date.now() - 10 * 60_000);
    await announceTurn({ view: view(), prev, record: RECORD, ai: { state: 'off' } });
    disp.spoke();
    said = [];
    await disp.utterance('Штаб, повтори', 1);
    expect(said[0].role).toBe('umpire');
    await disp.utterance('стоп', 2);
    expect(stop).toHaveBeenCalled();
  });
  it('конец игры — исход голосом посредника, затем предложение разбора («да» — составить разбор)', async () => {
    markVoice();
    const over = view({ over: true, outcome: { result: 'defeat', text: 'Предельный срок вышел.', at: null } });
    const ctl = fakeReview();
    turn({ view: over, review: { open: true, ctl, show: vi.fn() } });
    await announceTurn({ view: over, prev, record: RECORD, ai: { state: 'off' } });
    expect(said.find((x) => x.role === 'umpire')!.text).toMatch(/^Игра окончена: поражение\. Предельный срок вышел\./);
    expect(disp.pending).toMatchObject({ action: 'command.review.compose' });
    expect(last()).toMatch(/^Составить разбор операции\?/);
    await disp.utterance('да', 1);
    expect(ctl.compose).toHaveBeenCalled();
  });
});

describe('как действовал противник', () => {
  it('«как действовал противник» — решение штаба противника за прошлый ход, вкладка «Посредник»', async () => {
    const d = turn({ aiTurns: [AI_TURN] });
    expect(parsePhrase('как действовал противник', 'replay')).toEqual({ id: 'command.enemy.read' });
    await disp.utterance('Штаб, как действовал противник', 1);
    expect(last()).toMatch(/^Штаб противника, решение от шестнадцатого апреля: удержать вторую полосу у Зелова\./);
    expect(d.setTab).toHaveBeenCalledWith('umpire');
    expect(d.setUmpirePart).toHaveBeenCalledWith('enemy');
  });
  it('противник без штаба — честно', async () => {
    turn({ enemy: 'passive' });
    await disp.utterance('Штаб, как действовал противник', 1);
    expect(last()).toMatch(/без штаба/);
  });
});

// ---------------------------------------------------------------- разбор и файлы

function fakeReview(over: Partial<ReviewCtl> = {}): ReviewCtl & { compose: ReturnType<typeof vi.fn> } {
  const secs = [
    { id: 'command', title: 'Замысел и ведение операции', done: true, text: 'Замысел был **смелым**. Темп высокий.' },
    { id: 'logistics', title: 'Тыл и снабжение', done: false, text: '' },
    { id: 'summary', title: 'Итоговая оценка и уроки', done: true, text: '## Итог\nОперация проведена успешно. Урок: беречь танки.' },
  ];
  return { sections: () => secs, running: () => false, compose: vi.fn(async () => undefined), stop: vi.fn(), markdown: () => '# Разбор', pdf: async () => new Blob(['%PDF']),
    name: (ext: string) => `razbor-berlin.${ext}`, ...over } as never;
}

describe('разбор операции голосом', () => {
  it('«составь разбор» — окно открывается, разделы пишутся по очереди', async () => {
    const ctl = fakeReview();
    const d = turn({ review: { open: false, ctl: null, show: vi.fn() } });
    // окно открывается не сразу: управление разбором появляется, когда оно смонтировано
    const show = vi.fn((on: boolean) => { setTimeout(() => { d.review = { open: on, ctl, show }; }, 50); });
    d.review.show = show;
    expect(parsePhrase('составь разбор', 'replay')).toEqual({ id: 'command.review.compose', params: {} });
    expect(parsePhrase('составь разбор операции', 'replay')).toEqual({ id: 'command.review.compose', params: {} });
    const run = getAction('command.review.compose')!.run({});
    expect(show).toHaveBeenCalledWith(true);
    expect(await run).toMatch(/^Составляю разбор/);
    expect(ctl.compose).toHaveBeenCalledWith(undefined);
  });
  it('«прочитай итоговую оценку» — раздел вслух (без разметки); ненаписанный — честно', async () => {
    turn({ review: { open: true, ctl: fakeReview(), show: vi.fn() } });
    expect(parsePhrase('прочитай итоговую оценку', 'replay')).toEqual({ id: 'command.review.read', params: { section: 'итоговую оценку' } });
    await disp.utterance('Штаб, прочитай итоговую оценку', 1);
    expect(last()).toMatch(/^Итоговая оценка и уроки\. Итог\./);
    await disp.utterance('Штаб, дальше', 9);
    expect(last()).toMatch(/^Операция проведена успешно\./);
    expect(last()).not.toMatch(/[#*]/);
    await disp.utterance('Штаб, прочитай раздел тыл и снабжение', 2);
    expect(last()).toMatch(/«Тыл и снабжение» ещё не написан/);
  });
  it('ложные перехваты: «прочитай замысел» — поле решения, не разбор; без разбора «прочитай …» — не перехват', () => {
    turn({ review: { open: false, ctl: null, show: vi.fn() } });
    expect(parsePhrase('прочитай итоговую оценку', 'replay')).toBeNull();
    expect(parsePhrase('прочитай книгу', 'replay')).toBeNull();
    expect(parsePhrase('составь план', 'replay')).toBeNull();
    expect(parsePhrase('сохрани', 'replay')).toBeNull();
  });
  it('«сохрани разбор» — в настольном приложении в «Загрузки» без окна, штаб говорит куда', async () => {
    const saver = vi.fn(async (name: string) => ({ path: `/Users/x/Downloads/${name}` }));
    setSaver(saver);
    turn({ review: { open: true, ctl: fakeReview(), show: vi.fn() } });
    await disp.utterance('Штаб, сохрани разбор', 1);
    expect(saver).toHaveBeenCalledWith('razbor-berlin.pdf', expect.any(Blob));
    expect(last()).toBe('Разбор сохранён в папку «Загрузки».');
    await disp.utterance('Штаб, сохрани журнал', 2);
    expect(saver).toHaveBeenLastCalledWith('berlin-журнал.md', expect.any(Blob));
    expect(last()).toMatch(/^Журнал сохранён в папку «Загрузки»/);
  });
  it('в браузере — честно: браузер спросит, куда сохранить', async () => {
    const r = await saveFile('x.md', new Blob(['a']), { inApp: false, download: vi.fn() });
    expect(r).toEqual({ ok: true, where: 'browser' });
    turn({ review: { open: true, ctl: fakeReview(), show: vi.fn() } });
    setSaver(async () => 'browser');
    const say = await getAction('command.journal.save')!.run({}) as string;
    expect(say).toMatch(/браузер спросит, куда сохранить — это нужно сделать мышью/i);
  });
});

// ---------------------------------------------------------------- экранные действия (полнота: у кнопок — действия)

function screen(over: Partial<ScreenDeps> = {}): ScreenDeps {
  const d = {
    view: view(), busy: null, setTab: vi.fn(), setSub: vi.fn(), select: vi.fn(), sel: null, goTo: vi.fn(), drafts: {}, setDraft: vi.fn(),
    advisor: { open: false, min: false }, setAdvisor: vi.fn(), clearAdvisor: vi.fn(), setPlanN: vi.fn(), plan: null, planOpen: null, setPlanOpen: vi.fn(),
    takeSuggestion: vi.fn(), suggestion: () => null, hasAct: () => false, addAct: vi.fn(async () => true), dropAct: vi.fn(), acts: [],
    focus: true, focusOnly: true, setFocusOnly: vi.fn(), setTime: vi.fn(), toEditor: vi.fn(() => true), setUmpirePart: vi.fn(), setBounds: vi.fn(), ...over,
  } as unknown as ScreenDeps;
  const get = () => d;
  reg(screenActions(get));
  offs.push(() => releaseScreen(get));
  return d;
}

describe('экранные действия голосом', () => {
  it('фразы — действия', () => {
    screen();
    expect(parsePhrase('приказ восьмой гвардейской', 'replay')).toEqual({ id: 'command.order.open', params: { name: 'восьмой гвардейской' } });
    expect(parsePhrase('открой тыл', 'replay')).toEqual({ id: 'command.orders.sub', params: { sub: 'rear' } });
    expect(parsePhrase('открой вкладку резервы', 'replay')).toEqual({ id: 'command.orders.sub', params: { sub: 'reserves' } });
    expect(parsePhrase('покажи советника', 'replay')).toEqual({ id: 'command.advisor.show', params: { mode: 'open' } });
    expect(parsePhrase('скрой советника', 'replay')).toEqual({ id: 'command.advisor.show', params: { mode: 'close' } });
    expect(parsePhrase('раскрой второй вариант', 'replay')).toEqual({ id: 'command.variant.open', params: { n: 2 } });
    expect(parsePhrase('возьми из первого варианта второй приказ', 'replay')).toEqual({ id: 'command.variant.take', params: { n: 1, order: 2 } });
    expect(parsePhrase('в списках весь театр', 'replay')).toEqual({ id: 'map.focusOnly', params: { on: false } });
    expect(parsePhrase('открой карту в редакторе', 'replay')).toEqual({ id: 'command.toEditor', params: undefined });
    expect(parsePhrase('покажи поправки посредника', 'replay')).toEqual({ id: 'command.umpire.part', params: { part: 'umpire' } });
    expect(parsePhrase('покажи событие зееловские высоты', 'replay')).toEqual({ id: 'map.event', params: { name: 'зееловские высоты' } });
  });
  it('ложные перехваты: похожие фразы — не экранные действия', () => {
    screen();
    for (const s of ['приказ наступать на зелов', 'приказ какой', 'приказ восьмой гвардейской наступать на зелов', 'открой окно', 'открой дверь', 'покажи советы',
      'раскрой тайну', 'возьми из первого', 'в списках', 'открой карту', 'покажи все', 'открой войска противника', 'событие было вчера'])
      expect(parsePhrase(s, 'replay'), s).not.toMatchObject({ id: expect.stringMatching(/^(?:command\.(?:order\.open|orders\.sub|advisor\.show|variant\.(?:open|take)|toEditor|umpire\.part)|map\.(?:focusOnly|event))$/) });
    expect(parsePhrase('открой тыл', 'knowledge')).toBeNull();
  });
  it('«приказ восьмой гвардейской» — выбрать во вкладке «Приказы», штаб подсказывает, как сказать приказ', async () => {
    const d = screen();
    await disp.utterance('Штаб, приказ восьмой гвардейской', 1);
    expect(d.select).toHaveBeenCalledWith('su_8gva');
    expect(d.setTab).toHaveBeenCalledWith('orders');
    expect(last()).toMatch(/^Приказ восьмой гвардейской армии — во вкладке «Приказы»\. Скажите его целиком, например: «восьмой гвардейской армии наступать на/);
  });
  it('правка приказа в редакторе: задача сохраняет цель; противник — цель; «убрать»', async () => {
    const d = screen({ drafts: { su_8gva: order('su_8gva', 'attack') } });
    await getAction('command.order.set')!.run({ unit: 'su_8gva', task: 'hold' });
    expect(d.setDraft).toHaveBeenLastCalledWith('su_8gva', expect.objectContaining({ task: 'hold', target: 'Seelow' }));
    await getAction('command.order.set')!.run({ unit: 'su_8gva', enemy: 'de_56tk' });
    expect(d.setDraft).toHaveBeenLastCalledWith('su_8gva', expect.objectContaining({ target: { formation: 'de_56tk' }, targetText: 'против: LVI танковый корпус' }));
    await getAction('command.order.set')!.run({ unit: 'su_8gva', clear: true, note: 'Обойти с севера' });
    expect(d.setDraft).toHaveBeenLastCalledWith('su_8gva', expect.objectContaining({ target: null, at: null, note: 'Обойти с севера' }));
  });
  it('игра окончена, идёт расчёт хода — приказы недоступны с причиной', () => {
    const d = screen({ view: view({ over: true }) });
    expect(getAction('command.order.open')!.available()).toMatch(/игра окончена/);
    d.view = view(); d.busy = 'расчёт хода…';
    expect(getAction('command.order.set')!.available()).toMatch(/^считаю ход/);
  });
});
