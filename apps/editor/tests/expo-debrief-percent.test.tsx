// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ExpoView } from '../src/expo/ExpoView';
import { initialState, type DirectorState } from '../src/expo/director';
import { EXPO_DEFAULTS } from '../src/expo/settings';
afterEach(cleanup);
it.each([[0, 8, 0], [4, 8, 50], [8, 8, 100], [1, 3, 33]])('подготовка %s/%s показывает только %s процентов готовности', (done, total, percent) => {
  const state: DirectorState = { ...initialState(0), front: 'su_1bf', now: 90_000, phase: { kind: 'turn', n: 3, step: 'scroll', deadline: null, warned: false, offered: false, replacements: 0, choice: 0, preparing: true, debriefProgress: { done, total, stage: 'synthesis', started: 0 } } };
  const view = render(<ExpoView window={0} count={1} state={state} settings={EXPO_DEFAULTS} model={{ view: null, error: null }} send={() => {}} />);
  expect(view.getByRole('status').textContent).toBe(`Готовим итог — ${percent}%`);
});
