// Разбор прошедшего хода на карте (тур посредника): шаги из данных хода — общее с проигрыванием хода, главные бои
// (место — метка и рамка), продвижение к целям, тыл, что известно о противнике (только по разведке); текст —
// моделью одним запросом на весь разбор или по правилам.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntelReport, TurnBattle, UnitReport } from '@def-ops/sim';
import type { LngLat } from '@def-ops/core';
import type { TurnView } from '../src/sim/game-protocol';
import { TourEngine, tourEngine, type SpeechEnd, type TourDeps } from '../src/voice/tour';
import { act, parsePhrase, register } from '../src/voice/registry';
import { findLayer } from '../src/voice/actions/command';
import { flash, flashState } from '../src/voice/highlight';
import { createTourMap, MOVE_MS, PLAY_MS } from '../src/voice/tour-map';
import type { TourMap } from '../src/voice/tours';
import { REVIEW_SYSTEM, REVIEW_TOUR, reviewFromModel, reviewInput, reviewTour, turnReview } from '../src/voice/tours/turn';

const unit = (id: string, name: string, at: LngLat, over: Partial<UnitReport> = {}): UnitReport => ({
  id, name, parent: 'su_1bf', echelon: 'army', status: 'active', at, place: 'у Зелова', posture: 'наступает',
  task: 'наступать', target: 'на Берлин', orderSource: 'script', personnel: 75_400, tanks: 120, guns: 900, strength: 0.86, ammo: 1.4, fuel: 0.9,
  fatigue: 0.3, cutOff: false, movedKm: 6, combats: [], pending: [], ...over,
} as UnitReport);
const SEELOW: LngLat = [14.38, 52.53];
const OWN = [
  unit('su_8gva', '8-я гвардейская армия', [14.4, 52.55], { movedKm: 7.5 }),
  unit('su_5ua', '5-я ударная армия', [14.5, 52.65], { movedKm: 2 }),
  unit('su_69a', '69-я армия', [14.45, 52.4], { cutOff: true, movedKm: 0 }),
  unit('su_3ua', '3-я ударная армия', [14.6, 52.7], { movedKm: 12 }),
];
const INTEL: IntelReport[] = [
  { id: 'de_56tk', name: 'LVI танковый корпус', at: [14.3, 52.5], place: 'у Мюнхеберг', posture: 'обороняется', estimate: 'до 20 тыс. чел.', fresh: false, nearest: { name: '8-я гвардейская армия', km: 6 } },
  { id: 'de_11ss', name: 'XI танковый корпус СС', at: [14.2, 52.7], place: 'у Врицен', posture: 'обороняется', estimate: 'до 10 тыс. чел.', fresh: true, nearest: { name: '3-я ударная армия', km: 12 } },
];
/** Противник, которого разведка не видит: он есть в бою (соприкосновение), но его места мы не знаем. */
const HIDDEN: LngLat = [13.9, 52.45];
const battle = (over: Partial<TurnBattle>): TurnBattle => ({
  time: '1945-04-16T11:00', at: SEELOW, place: 'у Зелов (Seelow)', role: 'attack', own: [{ id: 'su_8gva', name: '8-я гвардейская армия' }],
  enemy: [{ id: 'de_56tk', name: 'LVI танковый корпус' }], outcome: 'breakthrough', outcomeText: 'прорыв', advanceKm: 6.5, ownLossPct: 4.2, ratio: 3.1, ...over,
});
const BATTLES = [
  battle({ outcome: 'held', outcomeText: 'оборона удержана', advanceKm: 0, ownLossPct: 1, at: [14.52, 52.66], place: 'у Леччин', own: [{ id: 'su_5ua', name: '5-я ударная армия' }], enemy: [{ id: 'de_9pd', name: '9-я парашютная дивизия' }] }),
  battle({}),
  battle({ role: 'defend', outcome: 'repelled', outcomeText: 'атака отбита', advanceKm: 0, ownLossPct: 2, at: [14.46, 52.41], place: 'у Лебус', own: [{ id: 'su_69a', name: '69-я армия' }], enemy: [{ id: 'de_x', name: 'дивизия «Мюнхеберг»' }] }),
  battle({ outcome: 'advance', outcomeText: 'продвижение', advanceKm: 3, ownLossPct: 3, at: [14.6, 52.71], place: 'у Врицен', own: [{ id: 'su_3ua', name: '3-я ударная армия' }], enemy: [{ id: 'de_11ss', name: 'XI танковый корпус СС' }] }),
  battle({ outcome: 'repelled', outcomeText: 'атака отбита', advanceKm: 0, ownLossPct: 6, at: [14.7, 52.8], place: 'у Ораниенбург', own: [{ id: 'su_3ua', name: '3-я ударная армия' }], enemy: [{ id: 'de_9pd', name: '9-я парашютная дивизия' }] }),
];
const view = (over: Partial<TurnView> = {}): TurnView => ({
  scenario: 'berlin-1945-tasks', scenarioName: 'Берлинская операция', rules: 'x', seed: 1, start: '1945-04-16T05:00', end: '1945-05-08T05:00',
  takeover: '1945-04-16T05:00', time: '1945-04-17T05:00', turnHours: 24, turn: 2, over: false, outcome: null,
  victory: 'Знамя Победы над рейхстагом', deadline: '1945-05-08T05:00', strength: 0.91, strengthBelow: 0.5,
  human: { id: 'su', name: 'СССР' }, ai: { id: 'de', name: 'Германия' }, terms: {} as TurnView['terms'],
  groups: [], own: OWN, intel: INTEL, events: ['8-я гвардейская армия прорвала первую полосу обороны у Зелова.'],
  battles: BATTLES, zones: null, zonesPrev: null,
  places: [], delays: {}, detectKm: 15,
  goals: [{ title: 'Зееловские высоты взяты: прорыв второй полосы', historical: '1945-04-17T18:00', simulated: '1945-04-17T03:00', days: 0, at: '1945-04-17T03:00', place: [14.4, 52.56] },
    { title: 'Окружение Берлина', historical: '1945-04-25T12:00', simulated: null, days: null, at: null, place: [13.4, 52.5] }],
  journal: [], doc: {} as TurnView['doc'], bases: [], priority: [], priorityMax: 3, supplyHours: {}, rangeHours: 24,
  bridges: [{ id: 'b1', name: 'Переправа у Кюстрина', at: [14.62, 52.58], openFrom: '1945-04-16T20:00', building: false }], parks: 2,
  lastDecision: null, sectors: [], boundaries: [], groupOf: {}, armies: [], reserveGroups: [],
  ...over,
} as TurnView);
const prev = view({
  time: '1945-04-16T05:00', turn: 1, battles: [], strength: 0.95, bridges: [],
  own: [...OWN.slice(0, 2), { ...OWN[2], cutOff: false }, { ...OWN[3], status: 'reserve' }],
  goals: view().goals.map((g) => ({ ...g, simulated: null, at: null })),
});

const steps = turnReview(view(), prev);
const pts = (s: (typeof steps)[number]) => [s.map.at, s.map.spot, ...(s.map.fit ?? []), ...(s.map.box ?? [])].filter(Boolean) as LngLat[];

describe('разбор хода: шаги из данных хода', () => {
  it('4–8 шагов: общее (карта проигрывает ход), главные бои, цели, тыл, противник', () => {
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.length).toBeLessThanOrEqual(8);
    expect(steps[0].kind).toBe('overview');
    expect(steps[0].map.play).toEqual(['1945-04-16T05:00', '1945-04-17T05:00']);
    expect(steps[0].map.fit!.length).toBeGreaterThan(1);
    expect(steps.map((s) => s.kind)).toEqual(expect.arrayContaining(['battle', 'goal', 'rear', 'enemy']));
    for (const s of steps) expect(s.text, s.title).not.toMatch(/\d/);
  });
  it('главные бои — не больше трёх, по важности (прорыв первым); место — метка и рамка вокруг участников', () => {
    const b = steps.filter((s) => s.kind === 'battle');
    expect(b.length).toBe(3);
    expect(b[0].map.spot).toEqual(SEELOW);
    expect(b[0].map.zoom).toBeGreaterThanOrEqual(9);
    expect(b[0].map.fit).toEqual(b[0].map.box);
    expect(b[0].map.box).toEqual(expect.arrayContaining([SEELOW, [14.4, 52.55], [14.3, 52.5]]));
    expect(b[0].text).toBe('У Зелова — наступление восьмой гвардейской армии против пятьдесят шестого танкового корпуса: прорыв на семь километров; потери — около четырёх процентов участвовавших.');
    expect(b.some((s) => /противник атаковал шестьдесят девятую армию/.test(s.text))).toBe(true);
  });
  it('туман войны: в данных для модели нет соотношения сил — сведений о противнике сверх разведки', () => {
    const inp = reviewInput(view(), steps);
    expect(inp).not.toMatch(/соотношени|\d:1|ratio|3[.,]1/i);
    for (const s of steps) expect(s.facts, s.title).not.toMatch(/соотношени|:1\b/);
    expect(inp).toMatch(/потери — [\d.]+ % от участвовавших в бою/); // потери — доля участвовавших в бою
  });
  it('места — в родительном падеже (названия театра — именительный), «и ещё» — с существительным и падежом', () => {
    const b = steps.filter((s) => s.kind === 'battle');
    expect(b.map((s) => s.title)).toEqual(expect.arrayContaining(['Бой у Зелова']));
    expect(steps.find((s) => s.kind === 'enemy')!.text).toMatch(/у Врицена/);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `de_x${i}`, name: `${i + 1}-я танковая дивизия` }));
    const one = (n: number, role: 'attack' | 'defend') => turnReview(view({ battles: [battle({ role, enemy: many(n), own: many(n).map((x) => ({ ...x, id: x.id.replace('de', 'su') })) })] }), prev).find((s) => s.kind === 'battle')!.text;
    expect(one(4, 'attack')).toMatch(/против первой танковой дивизии, второй танковой дивизии и ещё двух соединений:/);
    expect(one(3, 'attack')).toMatch(/и ещё одного соединения:/);
    expect(one(7, 'defend')).toMatch(/и ещё пять соединений;/);
    expect(one(4, 'defend')).toMatch(/и ещё два соединения;/);
    const fresh = view({ intel: [1, 2, 3, 4].map((i) => ({ ...INTEL[1], id: `de_${i}`, name: `${i}-я танковая дивизия`, fresh: true })) });
    expect(turnReview(fresh, prev).find((s) => s.kind === 'enemy')!.text).toMatch(/и ещё два соединения\./);
  });
  it('туман войны: на карте нет мест противника, которого не видит разведка; о противнике — только разведка и его атаки', () => {
    const fog = view({ battles: [battle({ enemy: [{ id: 'de_hid', name: 'дивизия «Курмарк»' }] })] });
    const all = turnReview(fog, prev).flatMap(pts);
    expect(all).not.toContainEqual(HIDDEN);
    for (const s of steps) for (const p of pts(s)) {
      const known = [...OWN.map((u) => u.at), ...INTEL.map((e) => e.at), ...BATTLES.map((x) => x.at), ...view().goals.map((g) => g.place), view().bridges[0].at];
      expect(known, s.title).toContainEqual(p);
    }
    const enemy = steps.find((s) => s.kind === 'enemy')!;
    expect(enemy.text).toMatch(/одиннадцатый танковый корпус СС/);
    expect(enemy.text).not.toMatch(/пятьдесят шест/); // не новый — о нём уже знали
    expect(enemy.map.spot ?? enemy.map.fit?.[0]).toEqual([14.2, 52.7]);
  });
  it('место словами: рядом с пунктом — «южнее …», дальше — «в … км к югу от …»', () => {
    const near = turnReview(view({ battles: [battle({ place: '6,3 км к Ю от Брисков (Briskow)' })] }), prev).find((s) => s.kind === 'battle')!;
    expect(near.title).toBe('Бой южнее Брискова');
    expect(near.text).toMatch(/^Южнее Брискова — наступление/);
    const far = turnReview(view({ battles: [battle({ place: '15 км к СЗ от Зелов (Seelow)' })] }), prev).find((s) => s.kind === 'battle')!;
    expect(far.title).toBe('Бой в 15 км к северо-западу от Зелова');
    expect(far.text).toMatch(/^Пятнадцать километров к северо-западу от Зелова — наступление/);
  });
  it('цели: достигнутое за ход — на месте события', () => {
    const g = steps.find((s) => s.kind === 'goal')!;
    expect(g.text).toMatch(/Зееловские высоты взяты/);
    expect(g.map.spot).toEqual([14.4, 52.56]);
  });
  it('тыл: отрезанные, наведённые переправы, ввод резервов', () => {
    const r = steps.find((s) => s.kind === 'rear')!;
    expect(r.text).toMatch(/Отрезаны от подвоза: шестьдесят девятая армия\./);
    expect(r.text).toMatch(/Действует новая переправа у Кюстрина\./);
    expect(r.text).toMatch(/Введены в бой: третья ударная армия\./);
  });
  it('ход без боёв и событий — всё равно общее и что дальше, без выдумок', () => {
    const quiet = turnReview(view({ battles: [], events: [], intel: [], bridges: [], own: OWN.map((u) => ({ ...u, cutOff: false })), goals: [view().goals[1]] }), view({ battles: [], own: OWN.map((u) => ({ ...u, cutOff: false })) }));
    expect(quiet[0].kind).toBe('overview');
    expect(quiet[0].text).toMatch(/боёв не было/);
    expect(quiet.map((s) => s.kind)).toContain('goal');
    expect(quiet.find((s) => s.kind === 'goal')!.text).toMatch(/Следующая цель — Окружение Берлина/);
  });
  it('боёв с местом нет (агентная модель), а донесения есть — главное из донесений', () => {
    const s = turnReview(view({ battles: [], engine: 'agents' }), prev);
    expect(s[0].text).toMatch(/Главное из донесений: восьмая гвардейская армия прорвала первую полосу обороны у Зелова\./);
  });
  it('конец игры — первым шагом исход', () => {
    const over = turnReview(view({ over: true, outcome: { result: 'victory', text: 'Знамя Победы поднято над рейхстагом.', at: '1945-04-30T22:00' } }), prev);
    expect(over[0].kind).toBe('outcome');
    expect(over[0].text).toMatch(/^Игра окончена: победа\. Знамя Победы поднято над рейхстагом\./);
  });
  it('без прошлой обстановки (продолженная игра) — ход проигрывается от начала хода', () => {
    const s = turnReview(view(), null);
    expect(s[0].map.play).toEqual(['1945-04-16T05:00', '1945-04-17T05:00']);
  });
});

describe('разбор хода: тур и модель', () => {
  it('тур посредника: раздел «Переигровка» в игре, на каждом шаге — карта; текст модели заменяет правила', () => {
    const t = reviewTour(steps);
    expect(t).toMatchObject({ id: REVIEW_TOUR, section: 'replay', game: true, role: 'umpire', title: 'Разбор хода' });
    expect(t.steps.every((s) => s.target === 'cmd-map' && !!s.map)).toBe(true);
    expect(t.steps.map((s) => s.text)).toEqual(steps.map((s) => s.text));
    const m = reviewTour(steps, steps.map((_, i) => `Шаг ${i}.`));
    expect(m.steps[1].text).toBe('Шаг 1.');
    expect(m.steps[1].map).toEqual(steps[1].map);
  });
  it('один запрос на весь разбор: данные по шагам, число шагов; ответ — пронумерованные тексты (числа словами)', () => {
    const inp = reviewInput(view(), steps);
    expect(inp).toMatch(new RegExp(`Шагов: ${steps.length}`));
    expect(inp).toMatch(/Шаг 1 \(/);
    expect(REVIEW_SYSTEM).toMatch(/посредник/);
    const ans = steps.map((_, i) => `${i + 1}. За ход 8-я гв. армия продвинулась на 7 км. Это **важно**.`).join('\n');
    const r = reviewFromModel(ans, steps.length)!;
    expect(r).toHaveLength(steps.length);
    expect(r[0]).toBe('За ход восьмая гвардейская армия продвинулась на семь километров. Это важно.');
  });
  it('ответ не по шагам (не хватает шага, пустой шаг) — не годится', () => {
    expect(reviewFromModel('1. Раз.\n2. Два.', 3)).toBeNull();
    expect(reviewFromModel('1. Раз.\n2.\n3. Три.', 3)).toBeNull();
    expect(reviewFromModel('Просто текст без номеров. Ещё. И ещё.', 3)).toBeNull();
  });
});

// ---------------------------------------------------------------- движок тура: шаги с картой, голос посредника

function rig() {
  const said: { text: string; role?: string; end(r: SpeechEnd): void }[] = [];
  const map = { show: vi.fn((_m: TourMap) => {}), pause: vi.fn(), reset: vi.fn() };
  const deps: TourDeps = {
    tours: [], section: () => 'replay', act: async () => {}, exists: () => true, sleep: () => Promise.resolve(), map,
    speak: (text, role) => {
      let end!: (r: SpeechEnd) => void;
      said.push({ text, role, end: (r) => end(r) });
      return { done: new Promise<SpeechEnd>((r) => { end = r; }), cancel: () => end('stopped') };
    },
  };
  return { e: new TourEngine(deps), said, map };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('разбор хода: движок тура', () => {
  const tour = reviewTour(steps);
  it('тур из данных (не из списка туров) — голосом посредника; на каждом шаге карта: переезд, метка, проигрывание хода', async () => {
    const { e, said, map } = rig();
    await e.start(tour);
    await flush();
    expect(e.state?.tour.id).toBe(REVIEW_TOUR);
    expect(said[0]).toMatchObject({ text: steps[0].text, role: 'umpire' });
    expect(map.show).toHaveBeenLastCalledWith(steps[0].map);
    said[0].end('played');
    await flush();
    expect(map.show).toHaveBeenLastCalledWith(steps[1].map);
    expect(steps[1].map.spot).toBeTruthy();
  });
  it('«назад», «повтори» — карта шага заново; «пауза» — проигрывание встаёт; «хватит» — карта как была', async () => {
    const { e, map } = rig();
    await e.start(tour);
    await flush();
    e.next(); await flush();
    e.back(); await flush();
    expect(map.show).toHaveBeenLastCalledWith(steps[0].map);
    e.pause();
    expect(map.pause).toHaveBeenCalled();
    e.repeat(); await flush();
    expect(map.show).toHaveBeenLastCalledWith(steps[0].map);
    e.stop();
    expect(map.reset).toHaveBeenCalledTimes(1);
    expect(e.state).toBeNull();
  });
  it('дошёл до конца — карта как была (время — конец хода)', async () => {
    const { e, said, map } = rig();
    const ends: string[] = [];
    await e.start(reviewTour(steps.slice(0, 2)), { onEnd: (r) => ends.push(r) });
    await flush(); said.at(-1)!.end('played'); await flush(); said.at(-1)!.end('played'); await flush();
    expect(ends).toEqual(['done']);
    expect(map.reset).toHaveBeenCalledTimes(1);
  });
  it('обычный тур — голосом начальника штаба, без карты', async () => {
    const { e, said, map } = rig();
    await e.start({ id: 'x', section: 'voice', title: 'X', steps: [{ target: 'a', title: 'А', text: 'первый' }] });
    await flush();
    expect(said[0].role).toBeUndefined();
    expect(map.show).not.toHaveBeenCalled();
  });
});

describe('разбор хода: команда посреди разбора', () => {
  let offs: (() => void)[] = [];
  afterEach(() => { tourEngine.stop(); offs.forEach((o) => o()); offs = []; });
  it('команда голосом исполняется, разбор встаёт на паузу; управление туром («дальше») — нет', async () => {
    const run = vi.fn(async () => 'Есть.');
    offs.push(register({ id: 'x.cmd', section: 'global', title: 'x', describe: 'x', available: () => true, run }));
    offs.push(register({ id: 'shell.open', section: 'global', title: 'x', describe: 'x', available: () => true, run: async () => {} }));
    offs.push(register({ id: 'tour.next', section: 'global', title: 'Дальше', describe: 'x', available: () => true, run: async () => { tourEngine.next(); } }));
    await tourEngine.start(reviewTour(steps));
    await flush();
    await act('tour.next', undefined, { by: 'voice' });
    await flush();
    expect(tourEngine.state).toMatchObject({ index: 1 });
    expect(tourEngine.state?.phase).not.toBe('paused');
    await act('x.cmd', undefined, { by: 'voice' });
    expect(run).toHaveBeenCalled();
    expect(tourEngine.state).toMatchObject({ index: 1, phase: 'paused' });
    // мышью (кнопка) — разбор не прерывается
    tourEngine.resume(); await flush();
    await act('x.cmd', undefined, { by: 'mouse' });
    expect(tourEngine.state?.phase).not.toBe('paused');
  });
});

// ---------------------------------------------------------------- карта шага: переезд, метка и рамка, проигрывание хода

describe('разбор хода: карта шага', () => {
  function fake() {
    let view = { center: [14, 52] as LngLat, zoom: 9, bearing: 0 };
    const times: string[] = [];
    let clock = 0;
    let cbs: (() => void)[] = [];
    const en = {
      getView: () => view, setView: (v: Partial<typeof view>) => { view = { ...view, ...v }; },
      project: (ll: LngLat): [number, number] => [(ll[0] - view.center[0]) * 100 * 2 ** (view.zoom - 9) + 500, (view.center[1] - ll[1]) * 160 * 2 ** (view.zoom - 9) + 400],
      unproject: (p: [number, number]): LngLat => [view.center[0] + (p[0] - 500) / (100 * 2 ** (view.zoom - 9)), view.center[1] - (p[1] - 400) / (160 * 2 ** (view.zoom - 9))],
      size: () => ({ width: 1000, height: 800 }),
    };
    const ctl = createTourMap({
      engine: () => en, setTime: (t) => times.push(t), now: () => '1945-04-17T05:00',
      frame: (cb) => { cbs.push(cb); return cbs.length; }, cancel: () => { cbs = []; }, clock: () => clock,
    });
    const tick = (ms: number) => { for (let t = 0; t < ms; t += 16) { clock += 16; const l = cbs; cbs = []; l.forEach((f) => f()); } };
    return { ctl, en, times, tick, view: () => view };
  }
  afterEach(() => flash(null));
  it('бой: карта плавно переезжает к месту, затем метка и рамка вокруг участников; время — конец хода', () => {
    const f = fake();
    const b = steps.find((s) => s.kind === 'battle')!;
    f.ctl.show(b.map);
    f.tick(MOVE_MS / 2);
    // место боя и участники — целиком: центр — середина рамки
    const xs = b.map.fit!.map((p) => p[0]), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const half = f.view().center;
    expect(half[0]).toBeGreaterThan(14); expect(half[0]).toBeLessThan(cx);
    expect(flashState()).toBeNull(); // метка — когда карта приехала
    f.tick(MOVE_MS);
    expect(f.view().center[0]).toBeCloseTo(cx, 5);
    expect(f.view().zoom).toBeLessThanOrEqual(b.map.zoom!);
    expect(flashState()).toMatchObject({ spots: [b.map.spot], boxes: [b.map.box] });
    expect(flashState()!.ms).toBeGreaterThan(30_000);
    expect(f.times.at(-1)).toBe('1945-04-17T05:00');
  });
  it('общее: показаны все войска; время карты идёт от начала хода к концу', () => {
    const f = fake();
    f.ctl.show(steps[0].map);
    expect(f.times[0]).toBe('1945-04-16T05:00');
    f.tick(MOVE_MS + PLAY_MS / 2);
    const mid = f.times.at(-1)!;
    expect(mid > '1945-04-16T05:00' && mid < '1945-04-17T05:00').toBe(true);
    f.tick(PLAY_MS);
    expect(f.times.at(-1)).toBe('1945-04-17T05:00');
    expect(f.view().zoom).toBeGreaterThanOrEqual(7);
    expect(f.view().zoom).toBeLessThanOrEqual(12);
  });
  it('пауза — проигрывание встаёт; конец разбора — время и подсветка как были', () => {
    const f = fake();
    f.ctl.show(steps[0].map);
    f.tick(MOVE_MS + 500);
    f.ctl.pause();
    const n = f.times.length;
    f.tick(PLAY_MS);
    expect(f.times.length).toBe(n);
    f.ctl.show(steps[1].map); f.tick(MOVE_MS * 2);
    expect(flashState()).not.toBeNull();
    f.ctl.reset();
    expect(f.times.at(-1)).toBe('1945-04-17T05:00');
    expect(flashState()).toBeNull();
  });
});

describe('зоны влияния: слой голосом', () => {
  it('«покажи / скрой зоны влияния» — слой карты zones', () => {
    expect(findLayer('зоны влияния')).toBe('zones');
    expect(findLayer('зоны влияния сторон')).toBe('zones');
    const off = register({ id: 'map.layer', section: 'replay', title: 'Слой', describe: 'x', available: () => true, run: async () => {} });
    try {
      expect(parsePhrase('скрой зоны влияния', 'replay')).toEqual({ id: 'map.layer', params: { layer: 'zones', on: false } });
      expect(parsePhrase('покажи зоны влияния', 'replay')).toEqual({ id: 'map.layer', params: { layer: 'zones', on: true } });
    } finally { off(); }
  });
});
