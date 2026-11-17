// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyDocument } from '@def-ops/core';
import { ExpoView, mapPlan } from '../src/expo/ExpoView';
import { initialState, type DirectorState } from '../src/expo/director';
import { setLens } from '../src/expo/lens';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import type { ModelView } from '../src/expo/session';
import type { StageMapProps } from '../src/expo/StageMap';
const stageMap = vi.hoisted(() => vi.fn((_props: StageMapProps) => null));
vi.mock('../src/expo/StageMap', () => ({ StageMap: stageMap }));
afterEach(cleanup);
const scales = { axes: { speed: 0, cost: 0, intent: 1, days: 0, lossRatio: 1, done: 2, due: 2 }, notes: { speed: '', cost: '', intent: '' } };
const base: ModelView = { front: 'su_1uf', turn: 3, time: '1945-04-23T05:00', hour: 168, decisions: [{ n: 2, choice: 'uf2-hist', historical: 'uf2-hist' }], reveal: null, blow: null, move: null, feed: [], final: null, busy: true, error: null, scales, map: { armies: [], prev: { armies: [], time: '1945-04-18T05:00' }, flashes: [], path: {} }, spare: 1, tasks: [], loss: { own: 0, ref: 0 }, berlinKm: { now: 0, history: 0 }, cards: [] };
const computed: ModelView = { ...base, busy: false, time: '1945-05-02T05:00', decisions: [...base.decisions, { n: 3, choice: 'uf3-hist', historical: 'uf3-hist' }], map: { ...base.map, prev: { armies: [], time: base.time } } };
const state: DirectorState = { ...initialState(0), front: base.front, phase: { kind: 'turn', n: 3, step: 'scroll', deadline: null, warned: false, offered: false, replacements: 0, choice: 0, scrollHold: true } };
const mapsAt = (time: string) => ({ session: { doc: emptyDocument(), front: base.front, time, zones: [] } });
it('во время расчёта третьего решения карта остаётся на начале текущего хода, а не предыдущего', () => {
  const plan = mapPlan({ state, mv: base, maps: mapsAt(base.time), lit: null, count: 1, index: 0 });
  expect(plan?.run).toBeNull();
  expect(plan?.time).toBe('1945-04-23T05:00');
});
it('до получения нового хода карта не запускает предыдущий и показывает состояние расчёта', () => {
  const mv = { ...base, busy: false };
  const maps = mapsAt(mv.time);
  const send = vi.fn();
  const plan = mapPlan({ state, mv, maps, lit: null, count: 1, index: 0 });
  expect(plan?.run).toBeNull();
  expect(plan?.time).toBe(mv.time);
  const shown = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} maps={maps} model={{ view: mv, error: null }} send={send} />);
  expect(shown.getByRole('status').textContent).toMatch(/считает ход операции/);
  expect(send).not.toHaveBeenCalledWith({ t: 'scrollReady' });
});
it('новые результаты не показывают конечную дату до готовности документа и начала прокрутки', () => {
  const mv = computed;
  const maps = mapsAt(base.time);
  const plan = mapPlan({ state, mv, maps, lit: null, count: 1, index: 0 });
  expect(plan?.run).toBeNull();
  expect(plan?.time).toBe(base.time);
  const shown = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} maps={maps} model={{ view: mv, error: null }} send={() => {}} />);
  expect(shown.container.querySelector('[data-clock]')?.textContent).toBe('23 апреля, 05:00');
  expect(shown.getByRole('status').textContent).toMatch(/Готовим карту/);
});
it('часы остаются на начале хода, пока не загрузился ни один документ карты', () => {
  const shown = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} model={{ view: computed, error: null }} send={() => {}} />);
  expect(shown.container.querySelector('[data-clock]')?.textContent).toBe('23 апреля, 05:00');
});
it('готовая прокрутка начинает видимые часы с from, без вспышки конечного 2 мая', () => {
  const mv = computed;
  const maps = mapsAt(mv.time);
  const plan = mapPlan({ state, mv, maps, lit: null, count: 1, index: 0 });
  expect(plan?.run?.from).toBe(base.time);
  expect(plan?.run?.delay ?? 0).toBe(0);
  const send = vi.fn();
  const props = { window: 0, count: 1 as const, settings: EXPO_DEFAULTS, maps, model: { view: mv, error: null } };
  const shown = render(<ExpoView {...props} state={state} send={send} />);
  expect(shown.container.querySelector('[data-clock]')?.textContent).toBe('23 апреля, 05:00');
  expect(shown.queryByRole('status')).toBeNull();
  expect(send).toHaveBeenCalledWith({ t: 'scrollReady' });
  const updated = vi.fn();
  if (state.phase.kind !== 'turn') throw Error('Ожидается перелом');
  shown.rerender(<ExpoView {...props} state={{ ...state, phase: { ...state.phase, scrollHold: false, scrollBegan: true } }} send={updated} />);
  expect(updated).not.toHaveBeenCalledWith({ t: 'scrollReady' });
});
it('ошибка подготовки карты занимает место статуса и видна как предупреждение', () => {
  const shown = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} maps={mapsAt(base.time)} model={{ view: computed, error: 'Не удалось подготовить карту' }} send={() => {}} />);
  expect(shown.getByRole('alert').textContent).toBe('Не удалось подготовить карту');
  expect(shown.queryByRole('status')).toBeNull();
});

it('на трёх мониторах только экран с картой проигрывает ход и посылает его события', () => {
  const maps = mapsAt(computed.time);
  for (const index of [0, 1, 2]) {
    const send = vi.fn();
    const shown = render(<ExpoView window={index} state={state} settings={EXPO_DEFAULTS} count={3} maps={maps} model={{ view: computed, error: null }} send={send} />);
    const map = stageMap.mock.lastCall?.[0];
    if (index === 1) {
      expect(map?.run?.from).toBe(base.time);
      expect(send).toHaveBeenCalledWith({ t: 'scrollReady' });
      map?.onDone?.();
      expect(send).toHaveBeenCalledWith({ t: 'scrollDone' });
    } else {
      expect(map?.doc).toBeNull();
      expect(map?.run ?? null).toBeNull();
      map?.onDone?.();
      expect(send).not.toHaveBeenCalled();
    }
    shown.unmount();
  }
});

it('на одном мониторе ход завершается даже при просмотре бокового экрана через линзу', () => {
  const send = vi.fn();
  const props = { window: 0, count: 1 as const, state, settings: EXPO_DEFAULTS, send };
  const shown = render(<ExpoView {...props} maps={mapsAt(base.time)} model={{ view: base, error: null }} />);
  act(() => setLens({ count: 3, window: 2 }));
  expect(shown.queryByRole('img', { name: 'Карта перелома' })).toBeNull();
  shown.rerender(<ExpoView {...props} maps={mapsAt(computed.time)} model={{ view: computed, error: null }} />);
  const map = stageMap.mock.lastCall?.[0];
  expect(map?.run?.from).toBe(base.time);
  expect(send).toHaveBeenCalledWith({ t: 'scrollReady' });
  map?.onDone?.();
  expect(send).toHaveBeenCalledWith({ t: 'scrollDone' });
});
