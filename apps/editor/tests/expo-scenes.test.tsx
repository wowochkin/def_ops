// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { debriefSentences, forecastParts, operationDebrief, resultBeat } from '../src/expo/debrief';
import { ExpoView, mapPlan, turnBbox } from '../src/expo/ExpoView';
import { emptyDocument } from '@def-ops/core';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import { initialState, step, type DirectorState } from '../src/expo/director';
import type { ModelView } from '../src/expo/session';
import type { ModelFrame } from '../src/expo/model';
afterEach(cleanup);

const scales = { axes: { speed: 0.5, cost: -0.2, intent: 1, days: -1.5, lossRatio: 1.06, done: 2, due: 2 }, notes: { speed: 'быстрее истории на 1,5 сут', cost: 'потери больше истории на 6 %', intent: 'выполнено 2 из 2' } };
const view = (patch: Partial<ModelView> = {}): ModelView => ({
  front: 'su_1bf', turn: 1, time: '1945-04-16T05:00', hour: 0, decisions: [], reveal: null, feed: [], final: null, busy: false, error: null, scales, map: { armies: [], prev: null, flashes: [], path: {} },
  spare: 1, tasks: [{ id: 'seelow', title: 'Прорыв Зееловских высот', historical: '1945-04-19', simulated: null, days: null }], loss: { own: 0, ref: 0 }, berlinKm: { now: 68, history: 68 }, move: null,
  cards: [
    { id: 'bf1-north', title: 'Обход высот с севера', lines: ['Танковые армии — севернее, через Врицен', 'б', 'в', 'г'] },
    { id: 'bf1-hist', title: 'Ночной штурм с прожекторами', lines: ['а', 'б', 'в', 'г'] },
    { id: 'bf1-south', title: 'Главный удар южнее, на Фюрстенвальде', lines: ['а', 'б', 'в', 'г'] },
  ],
  ...patch,
});
const at = (st: DirectorState, ev: Parameters<typeof step>[1]) => step(st, ev, EXPO_DEFAULTS).state;
const choose = () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'turn', n: 1 });
  return { ...s, phase: { ...s.phase, step: 'choose' } } as DirectorState;
};
const show = (state: DirectorState, model: ModelFrame, sent: unknown[] = []) =>
  render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} model={model} send={(e) => sent.push(e)} />);

it('turn shows bank cards with gist, details open in place, choice is sent', () => {
  const sent: unknown[] = [];
  const v = show(choose(), { view: view(), error: null }, sent);
  expect(v.getByRole('heading', { name: 'Зееловские высоты' })).toBeTruthy();
  expect(v.queryByRole('img', { name: 'Ночной штурм: прожектор' })).toBeNull();
  expect(v.getByText('Обход высот с севера')).toBeTruthy();
  expect(v.getByText('Танковые армии — севернее, через Врицен')).toBeTruthy();
  expect(v.queryByText('г')).toBeNull();
  expect(v.queryByRole('timer')).toBeNull();
  fireEvent.click(v.getByRole('button', { name: 'Подробнее о карточке 1' }));
  expect(v.getByText('г')).toBeTruthy();
  fireEvent.click(v.getByRole('button', { name: 'Свернуть' }));
  expect(v.queryByText('г')).toBeNull();
  fireEvent.click(v.getByRole('button', { name: 'Карточка 2' }));
  expect(sent).not.toContainEqual({ t: 'choose', card: 1 });
  expect(v.getByText('Принять вариант 2 — Ночной штурм с прожекторами?')).toBeTruthy();
  fireEvent.click(v.getByRole('button', { name: 'Отмена' }));
  expect(v.queryByText(/Принять вариант/)).toBeNull();
  fireEvent.click(v.getByRole('button', { name: 'Карточка 2' }));
  fireEvent.click(v.getByRole('button', { name: 'Подтвердить' }));
  expect(sent).toContainEqual({ t: 'choose', card: 1 });
  fireEvent.click(v.getByRole('button', { name: 'Подробнее о карточке 3' }));
  fireEvent.click(v.getByRole('button', { name: 'Выбрать вариант 3' }));
  expect(sent).toContainEqual({ t: 'choose', card: 2 });
});

it('front choice returns to the attract screen', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'welcome' });
  const sent: unknown[] = [];
  const v = show(s, { view: null, error: null }, sent);
  fireEvent.click(v.getByRole('button', { name: 'На заставку' }));
  expect(sent).toContainEqual({ t: 'back' });
  expect(v.queryByRole('button', { name: 'Начать заново' })).toBeNull();
});

it('the result account is the commander speaking about this session', () => {
  const d = operationDebrief(view({
    final: { scales, rank: 'Генерал армии', matches: 0, forecast: 'Берлин пал бы 29 апреля — на день раньше истории' },
    decisions: [{ n: 1, choice: 'bf1-north', historical: 'bf1-hist' }],
  }));
  expect(d?.voice).toBe('zhukov-14s');
  const text = d?.paragraphs.join(' ') ?? '';
  expect(text).toMatch(/Разбираю, как она прошла/);
  expect(debriefSentences(['3-я гв. танковая штурмует юг Берлина. 28-я и 3-я гв. армии держат котёл.'])).toEqual([
    '3-я гв. танковая штурмует юг Берлина.',
    '28-я и 3-я гв. армии держат котёл.',
  ]);
  expect(text).toMatch(/Кюстрин|Зеелов/);
  expect(text).toMatch(/севернее, через Врицен/);
  expect(text).toMatch(/суток/);
  expect(text).not.toMatch(/Я Жуков|Я Конев|я вёл иначе/);
  expect(forecastParts('Берлин пал бы 29 апреля — на день раньше истории')).toEqual({ head: 'Берлин пал бы 29 апреля', deck: 'на день раньше истории' });
  expect(forecastParts('К концу расчёта Берлин не пал бы (в истории — 2 мая)').deck).toBe('');
});

it('the map screen situation names forces, the enemy and the ground, and the camera stays on that sector', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'turn', n: 1 });
  const state = { ...s, front: 'su_1bf' as const };
  const v = render(<ExpoView window={1} state={state} settings={EXPO_DEFAULTS} count={3} model={{ view: view(), error: null }} send={() => {}} />);
  expect(v.getByText(/9-я армия/)).toBeTruthy();
  expect(v.getByText('908 500')).toBeTruthy();
  expect(v.getByText(/Одербрух/)).toBeTruthy();
  const west = view({ map: { armies: [{ id: 'de_12', label: '12 А', side: 'de', front: 'su_1bf', at: [11.6, 52.1] }], prev: null, flashes: [], path: {} } });
  const plan = mapPlan({
    state,
    mv: west,
    maps: { history: { doc: emptyDocument(), front: null, time: '1945-05-02T20:00', zones: [] } },
    lit: null,
    count: 3,
    index: 1,
  });
  const b = plan?.camera?.bbox ?? turnBbox('su_1bf', 1);
  expect(b[0]).toBeGreaterThan(13.2);
  expect(b[2]).toBeGreaterThan(14.3);
  expect(b[3]).toBeLessThan(53.1);
});

it('situation and decision are tabs until the order is given', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'turn', n: 1 });
  const sent: unknown[] = [];
  const v = show(s, { view: view(), error: null }, sent);
  fireEvent.click(v.getByRole('button', { name: 'Решение' }));
  expect(sent).toContainEqual({ t: 'step', step: 'choose' });
  expect(v.queryByRole('button', { name: 'Ход операции' })).toBeNull();
});

it('explain shows situation and the opening forces; scales only after a decision; timer shows seconds only with a limit', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'turn', n: 1 });
  const v = show(s, { view: view(), error: null });
  expect(v.getAllByText(/Зееловские высоты, главная полоса обороны/).length).toBeGreaterThan(0);
  // до первого решения — обстановка на начало (силы из доклада), без пустых шкал и служебных фраз
  expect(v.getAllByText(/9-я армия/).length).toBeGreaterThan(0);
  expect(v.getAllByText('908 500').length).toBeGreaterThan(0);
  expect(v.queryAllByRole('meter')).toHaveLength(0);
  expect(v.queryByText(/нет эталона|события ещё впереди|задачи впереди/)).toBeNull();
  cleanup();
  const c = choose();
  const w = show({ ...c, phase: { ...c.phase, deadline: c.now + 25_000 } } as DirectorState, { view: view(), error: null });
  expect(w.getByRole('timer').textContent).toBe('25 с');
});

it('scroll reveals the marshal decision and the course of operation', () => {
  const s = at(choose(), { t: 'choose', card: 0 });
  const v = show(s, { view: view({ time: '1945-04-20T05:00', decisions: [{ n: 1, choice: 'bf1-north', historical: 'bf1-hist' }], loss: { own: 23_400, ref: 21_600 }, berlinKm: { now: 41, history: 52 }, reveal: { text: 'Жуков решил иначе — вот как', historical: view().cards[1] }, feed: ['18 апреля — Прорыв Зееловских высот (в истории — 19 апреля)'] }), error: null });
  expect(v.getByText('Жуков решил иначе — вот как')).toBeTruthy();
  expect(v.getByText('Ночной штурм с прожекторами')).toBeTruthy();
  expect(v.getAllByText('20 апреля, 05:00').length).toBeGreaterThan(0);
  expect(v.getByText('18 апреля — Прорыв Зееловских высот (в истории — 19 апреля)')).toBeTruthy();
  // сводка против истории: до Берлина, потери, темп; шкалы — с данными
  expect(v.getByText('41 км')).toBeTruthy();
  expect(v.getByText('потери; в истории к этому часу — 21 600')).toBeTruthy();
  expect(v.getAllByRole('meter')).toHaveLength(3);
});

it('result shows rank, forecast, axes and matches; core failure is shown', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'result' });
  const v = show(s, { view: view({ final: { scales, rank: 'Генерал армии', matches: 2, forecast: 'Берлин пал бы 29 апреля — на день раньше истории' } }), error: null });
  expect(v.getByText('Генерал армии')).toBeTruthy();
  expect(v.getByText('Берлин пал бы 29 апреля')).toBeTruthy();
  expect(v.getByText('на день раньше истории')).toBeTruthy();
  expect(v.getByText('Совпало с историческим решением: 2 из 3')).toBeTruthy();
  expect(v.getByText(/Сыграйте за .* фронт/)).toBeTruthy();
  expect(v.getByRole('heading', { name: 'Расчёт модели' })).toBeTruthy();
  cleanup();
  const played = view({
    time: '1945-05-02T05:00',
    final: { scales, rank: 'Генерал армии', matches: 2, forecast: 'Берлин пал бы 29 апреля — на день раньше истории' },
    decisions: [{ n: 1, choice: 'bf1-north', historical: 'bf1-hist' }],
  });
  const brief = operationDebrief(played);
  const turnLine = debriefSentences(brief?.paragraphs.slice(1, 2) ?? [])[0];
  expect(resultBeat(played, null).phase).toBe('open');
  expect(resultBeat(played, turnLine)).toMatchObject({ phase: 'turn', turn: 1 });
  const state = { ...s, front: 'su_1bf' as const };
  const model = { view: played, error: null };
  const ai = { line: { text: turnLine, source: 'now' }, said: turnLine, answer: null, thinking: null, ear: 'speak' as const };
  const left = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={3} model={model} ai={ai} send={() => {}} />);
  expect(left.getByText(turnLine)).toBeTruthy();
  expect(left.queryByRole('heading', { name: 'Расчёт модели' })).toBeNull();
  expect(left.queryByRole('img', { name: /Участок, о котором говорит/ })).toBeNull();
  cleanup();
  const center = render(<ExpoView window={1} state={state} settings={EXPO_DEFAULTS} count={3} model={model} ai={ai} send={() => {}} />);
  expect(center.getByRole('img', { name: /Участок, о котором говорит/ })).toBeTruthy();
  expect(center.queryByText(turnLine)).toBeNull();
  cleanup();
  const right = render(<ExpoView window={2} state={state} settings={EXPO_DEFAULTS} count={3} model={model} ai={ai} send={() => {}} />);
  expect(right.getByRole('heading', { name: 'Расчёт модели' })).toBeTruthy();
  expect(right.getByRole('heading', { name: 'Зееловские высоты' })).toBeTruthy();
  expect(right.queryByText(turnLine)).toBeNull();
  const session = { doc: emptyDocument(), front: 'su_1bf' as const, time: played.time, zones: [] };
  const plan = mapPlan({ state, mv: played, maps: { session }, lit: null, count: 3, index: 1, spoken: turnLine });
  expect(plan?.camera?.key.startsWith('result-turn-1-')).toBe(true);
  const other = mapPlan({ state, mv: played, maps: { session }, lit: null, count: 3, index: 1, spoken: 'Другая фраза разбора про Эльбу.' });
  expect(other?.camera?.key).not.toBe(plan?.camera?.key);
  expect(plan?.extra?.some((f) => f.id === 'result-sector')).toBe(true);
  expect(mapPlan({ state, mv: played, maps: { session }, lit: null, count: 3, index: 0, spoken: turnLine })).toBeNull();
  cleanup();
  const w = show(choose(), { view: null, error: 'Модель недоступна: нет ядра' });
  expect(w.getAllByRole('alert')[0].textContent).toBe('Модель недоступна: нет ядра');
});

it('maps: panorama replay, briefing camera to the front, turn arrows of the expanded card', () => {
  const base = at(initialState(0), { t: 'ready' });
  const r1 = show(base, { view: null, error: null });
  expect(r1.getByRole('img', { name: 'Переигровка Берлинской операции' })).toBeTruthy();
  cleanup();
  const brief = { ...base, front: 'su_1uf', phase: { kind: 'briefing', point: 0 } } as DirectorState;
  const r2 = show(brief, { view: null, error: null });
  expect(r2.getByRole('img', { name: /^Обстановка к 16 апреля 1945/ })).toBeTruthy();
  // доклад по пунктам: первый пункт — задача по директиве, цифры с источником
  expect(r2.getByRole('heading', { name: 'Задача фронта' })).toBeTruthy();
  expect(r2.getByText(/директива Ставки № 11060/)).toBeTruthy();
  cleanup();
  const arrows = [{ army: 'su_8gva', from: [14.6, 52.6] as [number, number], to: [14.1, 52.7] as [number, number], kind: 'attack' }];
  const v = view();
  v.cards[0] = { ...v.cards[0], arrows };
  // карта перелома — документ сеанса, стрелки приказа подсвеченной карточки — знаками атласа поверх
  const session = { doc: emptyDocument(), front: 'su_1bf' as const, time: v.time, zones: [] };
  const plan = (lit: number | null) => mapPlan({ state: choose(), mv: v, maps: { session }, lit, count: 1, index: 0 });
  expect(plan(null)?.extra).toBeUndefined();
  expect(plan(0)?.extra?.map((f) => f.kind)).toEqual(['arrow']);
  expect(plan(0)?.doc).toBe(session.doc);
});

it('one monitor: header shows any screen of the three-screen layout full-size', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'turn', n: 1 });
  const v = show(s, { view: view(), error: null });
  expect(v.getByRole('button', { name: 'Все вместе' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(v.getByRole('button', { name: '3' }));
  expect(v.getByRole('heading', { name: 'Ход операции' })).toBeTruthy();
  expect(v.queryByRole('heading', { name: 'Карта' })).toBeNull();
  fireEvent.click(v.getByRole('button', { name: '1' }));
  expect(v.getByRole('heading', { name: 'Штаб ИИ' })).toBeTruthy();
  expect(v.queryByRole('heading', { name: 'Ход операции' })).toBeNull();
  fireEvent.click(v.getByRole('button', { name: 'Все вместе' }));
  expect(v.getByRole('heading', { name: 'Карта' })).toBeTruthy();
});

it('briefing: map, figures and excursion are different screens', () => {
  const s = { ...at(initialState(0), { t: 'ready' }), front: 'su_1bf' as const, phase: { kind: 'briefing' as const, point: 2 } };
  const model = { view: null, error: null };
  const facts = render(<ExpoView window={0} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={() => {}} />);
  expect(facts.getByRole('heading', { name: 'Противник' })).toBeTruthy();
  expect(facts.queryByRole('heading', { name: 'Одерско-нейсенский рубеж' })).toBeNull();
  cleanup();
  const map = render(<ExpoView window={1} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={() => {}} />);
  expect(map.getByRole('img', { name: /Обстановка к 16 апреля 1945/ })).toBeTruthy();
  expect(map.queryByText('20–40 км')).toBeNull();
  cleanup();
  const note = render(<ExpoView window={2} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={() => {}} />);
  expect(note.getByRole('heading', { name: 'Одерско-нейсенский рубеж' })).toBeTruthy();
  expect(note.getByText('20–40 км')).toBeTruthy();
  expect(note.getByText(/с\. 246–248/)).toBeTruthy();
  expect(note.queryByRole('img', { name: /Обстановка к 16 апреля 1945/ })).toBeNull();
});

it('after a move the map shows the advance and the staff shows the enemy', () => {
  const s = at(choose(), { t: 'choose', card: 0 });
  const move = {
    advanceKm: 18, closerKm: 12, taken: ['Прорыв Зееловских высот'], crossings: ['1 УФ форсировал Шпрее'], enemyKm: 9,
    enemy: 'Противник сдвинулся: дальше всех его армия прошла 9 км.',
  };
  const model = { view: view({ decisions: [{ n: 1, choice: 'bf1-north', historical: 'bf1-hist' }], move, reveal: { text: 'Жуков решил иначе — вот как', historical: view().cards[1] } }), error: null };
  const map = render(<ExpoView window={1} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={() => {}} />);
  expect(map.getByText('18 км')).toBeTruthy();
  expect(map.getByText('Прорыв Зееловских высот')).toBeTruthy();
  expect(map.getByText('Переправа: 1 УФ форсировал Шпрее')).toBeTruthy();
  expect(map.queryByText(/Противник сдвинулся/)).toBeNull();
  cleanup();
  const ai = render(<ExpoView window={0} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={() => {}} />);
  expect(ai.getByText(/Противник сдвинулся/)).toBeTruthy();
  expect(ai.queryByText('18 км')).toBeNull();
  cleanup();
  const progress = render(<ExpoView window={2} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={() => {}} />);
  expect(progress.getByText('Потери и сравнение с этим днём')).toBeTruthy();
});

it('ai screen offers questions and the balance, not a bare situation line', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'turn', n: 1 });
  const sent: unknown[] = [];
  const v = render(<ExpoView window={0} state={s} settings={EXPO_DEFAULTS} count={3} model={{ view: view(), error: null }} send={(e) => sent.push(e)} />);
  expect(v.getByRole('heading', { name: 'Штаб ИИ' })).toBeTruthy();
  expect(v.getByRole('button', { name: 'Какие силы участвуют?' })).toBeTruthy();
  expect(v.getByText('8 : 1')).toBeTruthy();
  expect(v.getByText(/Голос: Молчит/)).toBeTruthy();
  expect(v.queryByText(/Плацдарм за Одером/)).toBeNull();
  fireEvent.click(v.getByRole('button', { name: 'Какие силы участвуют?' }));
  expect(sent).toContainEqual({ t: 'ask', q: 'Какие силы участвуют?' });
  fireEvent.change(v.getByLabelText('Свой вопрос штабу'), { target: { value: 'Сколько километров до Берлина?' } });
  fireEvent.click(v.getByRole('button', { name: 'Спросить' }));
  expect(sent).toContainEqual({ t: 'ask', q: 'Сколько километров до Берлина?' });
});

it('chronicle on the combined attract shows a single caption', () => {
  const s = at(initialState(0), { t: 'ready' });
  const v = render(<ExpoView window={0} state={s} settings={EXPO_DEFAULTS} count={1} model={{ view: null, error: null }} send={() => {}} />);
  expect(v.container.querySelectorAll('.expo-reel figcaption')).toHaveLength(1);
  expect(v.container.querySelectorAll('.expo-reel img')).toHaveLength(1);
});

it('attract: screen 1 explains the staff, screen 2 is the map, screen 3 is the full app', () => {
  const s = at(initialState(0), { t: 'ready' });
  const model = { view: null, error: null } as const;
  const sent: unknown[] = [];
  const a = render(<ExpoView window={0} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={(e) => sent.push(e)} />);
  expect(a.getByRole('heading', { name: 'Как работает штаб ИИ' })).toBeTruthy();
  expect(a.getByRole('heading', { name: 'Армии идут по часам' })).toBeTruthy();
  expect(a.getByText('База знаний')).toBeTruthy();
  expect(a.queryByRole('img', { name: 'Переигровка Берлинской операции' })).toBeNull();
  fireEvent.click(a.getByRole('button', { name: 'Голос: вкл' }));
  expect(sent).toEqual([{ t: 'voice' }]);
  cleanup();
  const b = render(<ExpoView window={1} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={() => {}} />);
  expect(b.getByRole('img', { name: 'Переигровка Берлинской операции' })).toBeTruthy();
  expect(b.getByText(/Рекорд дня/)).toBeTruthy();
  expect(b.queryByRole('heading', { name: 'Как работает штаб ИИ' })).toBeNull();
  cleanup();
  const opened: unknown[] = [];
  const c = render(<ExpoView window={2} state={s} settings={EXPO_DEFAULTS} count={3} model={model} send={(e) => opened.push(e)} />);
  expect(c.getByRole('heading', { name: 'Полная версия' })).toBeTruthy();
  expect(c.getByRole('img', { name: 'Карта операции' })).toBeTruthy();
  expect(c.queryByRole('img', { name: 'Моделирование' })).toBeNull();
  fireEvent.click(c.getByRole('tab', { name: 'Моделирование' }));
  expect(c.getByRole('img', { name: 'Моделирование' })).toBeTruthy();
  expect(opened).toEqual([]);
  expect(c.queryByText(/Рекорд дня/)).toBeNull();
  expect(c.queryByRole('img', { name: 'Переигровка Берлинской операции' })).toBeNull();
});

it('front choice: side screens show the marshals, the center marks a front until the start button', () => {
  const welcome = { ...at(initialState(0), { t: 'ready' }), phase: { kind: 'welcome' as const } };
  const left = render(<ExpoView window={0} state={welcome} settings={EXPO_DEFAULTS} count={3} send={() => {}} />);
  expect(left.getByRole('heading', { name: 'Георгий Жуков' })).toBeTruthy();
  expect(left.queryByRole('heading', { name: 'Выберите фронт' })).toBeNull();
  cleanup();
  const right = render(<ExpoView window={2} state={welcome} settings={EXPO_DEFAULTS} count={3} send={() => {}} />);
  expect(right.getByRole('heading', { name: 'Иван Конев' })).toBeTruthy();
  cleanup();
  const sent: unknown[] = [];
  const mid = render(<ExpoView window={1} state={welcome} settings={EXPO_DEFAULTS} count={3} send={(e) => sent.push(e)} />);
  fireEvent.click(mid.getByRole('button', { name: /1-й Украинский/ }));
  expect(sent).toContainEqual({ t: 'markFront', front: 'su_1uf' });
  expect(sent.some((e) => (e as { t: string }).t === 'pickFront')).toBe(false);
  cleanup();
  const picked = { ...welcome, front: 'su_1uf' as const };
  const go = render(<ExpoView window={1} state={picked} settings={EXPO_DEFAULTS} count={3} send={(e) => sent.push(e)} />);
  fireEvent.click(go.getByRole('button', { name: 'Начать операцию' }));
  expect(sent).toContainEqual({ t: 'pickFront', front: 'su_1uf' });
});
