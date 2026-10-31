// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ExpoView } from '../src/expo/ExpoView';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import { initialState, step, type DirectorState } from '../src/expo/director';
import type { ModelView } from '../src/expo/session';
import type { ModelFrame } from '../src/expo/model';
afterEach(cleanup);

const scales = { axes: { speed: 0.5, cost: -0.2, intent: 1, days: -1.5, lossRatio: 1.06, done: 2, due: 2 }, notes: { speed: 'быстрее истории на 1,5 сут', cost: 'потери больше истории на 6 %', intent: 'выполнено 2 из 2' } };
const view = (patch: Partial<ModelView> = {}): ModelView => ({
  front: 'su_1bf', turn: 1, time: '1945-04-16T05:00', hour: 0, decisions: [], reveal: null, feed: [], final: null, busy: false, error: null, scales,
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

it('turn shows bank cards, details expand, choice is sent', () => {
  const sent: unknown[] = [];
  const v = show(choose(), { view: view(), error: null }, sent);
  expect(v.getByText('Перелом 1 · Зееловские высоты')).toBeTruthy();
  expect(v.getByText('Обход высот с севера')).toBeTruthy();
  expect(v.queryByText('Танковые армии — севернее, через Врицен')).toBeNull();
  fireEvent.click(v.getByText('Подробнее о карточке 1'));
  expect(v.getByText('Танковые армии — севернее, через Врицен')).toBeTruthy();
  fireEvent.click(v.getByRole('button', { name: 'Карточка 2' }));
  expect(sent).toContainEqual({ t: 'choose', card: 1 });
  expect(v.getAllByRole('meter')).toHaveLength(3);
  expect(v.getByText('быстрее истории на 1,5 сут')).toBeTruthy();
});

it('scroll reveals the marshal decision and the course of operation', () => {
  const s = at(choose(), { t: 'choose', card: 0 });
  const v = show(s, { view: view({ time: '1945-04-20T05:00', reveal: { text: 'Жуков решил иначе — вот как', historical: view().cards[1] }, feed: ['18 апреля — Прорыв Зееловских высот (в истории — 19 апреля)'] }), error: null });
  expect(v.getByText('Жуков решил иначе — вот как')).toBeTruthy();
  expect(v.getByText('Ночной штурм с прожекторами')).toBeTruthy();
  expect(v.getAllByText('20 апреля, 05:00').length).toBeGreaterThan(0);
  expect(v.getByText('18 апреля — Прорыв Зееловских высот (в истории — 19 апреля)')).toBeTruthy();
});

it('result shows rank, forecast, axes and matches; core failure is shown', () => {
  const s = at(at(initialState(0), { t: 'ready' }), { t: 'jump', phase: 'result' });
  const v = show(s, { view: view({ final: { scales, rank: 'Генерал армии', matches: 2, forecast: 'Берлин пал бы 29 апреля — на день раньше истории' } }), error: null });
  expect(v.getByText('Генерал армии')).toBeTruthy();
  expect(v.getByText('Берлин пал бы 29 апреля — на день раньше истории')).toBeTruthy();
  expect(v.getByText('Вы выбрали как маршал: 2 из 3')).toBeTruthy();
  cleanup();
  const w = show(choose(), { view: null, error: 'Модель недоступна: нет ядра' });
  expect(w.getAllByRole('alert')[0].textContent).toBe('Модель недоступна: нет ядра');
});
