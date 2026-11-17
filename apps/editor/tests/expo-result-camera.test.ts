// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { emptyDocument } from '@def-ops/core';
import { mapPlan } from '../src/expo/ExpoView';
import { debriefSentences, operationDebrief } from '../src/expo/debrief';
import { initialState, type DirectorState } from '../src/expo/director';
import type { ModelView } from '../src/expo/session';

const scales = { axes: { speed: 0.5, cost: -0.2, intent: 1, days: -1.5, lossRatio: 1.06, done: 2, due: 2 }, notes: { speed: 'быстрее истории', cost: 'потери больше истории', intent: 'выполнено 2 из 2' } };
const mv: ModelView = {
  front: 'su_1uf', turn: 3, time: '1945-05-02T05:00', hour: 384, decisions: [{ n: 3, choice: 'uf3-hist', historical: 'uf3-hist' }],
  reveal: null, blow: null, move: null, feed: [], busy: false, error: null, scales, map: { armies: [], prev: null, flashes: [], path: {} },
  spare: 1, tasks: [], loss: { own: 0, ref: 0 }, berlinKm: { now: 0, history: 0 }, cards: [],
  final: { scales, rank: 'Генерал армии', matches: 1, forecast: 'Берлин взят' },
};
const state: DirectorState = { ...initialState(0), front: 'su_1uf', phase: { kind: 'result' } };
const plan = (spoken: string | null) => mapPlan({ state, mv, maps: { session: { doc: emptyDocument(), front: mv.front, time: mv.time, zones: [] } }, lit: null, count: 3, index: 1, spoken });

it('итог сразу открывает обзор, игнорируя оставшуюся реплику о Торгау из третьего решения', () => {
  const opening = plan(null)!;
  const stale = plan('Выбор посетителя «Юг города и выход к Торгау» полностью совпал с историческим замыслом маршала Конева, обеспечив соединение с американскими войсками у Эльбы.')!;
  expect(stale.camera).toEqual(opening.camera);
  expect(stale.time).toEqual(opening.time);
  expect(stale.run).toBeNull();
  expect(opening.camera?.scale).toBe(1_500_000);
  expect(opening.camera?.ms).toBe(0);
});

it('после вступления камера следует настоящей фразе текущего разбора', () => {
  const brief = operationDebrief(mv)!;
  const line = debriefSentences(brief.paragraphs.slice(1, 2)).find((s) => /Торгау|Берлин|Эльб/.test(s))!;
  expect(line).toBeTruthy();
  const active = plan(line)!;
  expect(active.camera?.key).not.toEqual(plan(null)?.camera?.key);
  expect(active.camera?.key.startsWith('result-turn-3')).toBe(true);
});

it('без озвученного разбора карта сразу показывает конец операции без вступительной прокрутки', () => {
  const result = mapPlan({ state: { ...state, phase: { kind: 'result', narrated: false } }, mv,
    maps: { session: { doc: emptyDocument(), front: mv.front, time: mv.time, zones: [] } }, lit: null, count: 3, index: 1 })!;
  expect(result.run).toBeNull();
  expect(result.time).toBe(mv.time);
  expect(result.camera?.ms).toBe(0);
});
