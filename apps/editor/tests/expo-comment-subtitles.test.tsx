// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ExpoView } from '../src/expo/ExpoView';
import { initialState, type DirectorState } from '../src/expo/director';
import { NO_AI } from '../src/expo/ai-runner';
import { EXPO_DEFAULTS } from '../src/expo/settings';
afterEach(cleanup);
const state: DirectorState = { ...initialState(1000), front: 'su_1uf', phase: { kind: 'turn', n: 2, step: 'scroll', deadline: null, warned: false, offered: false, replacements: 0, choice: 0, commenting: { token: 1 } } };
const text = 'Ваше решение позволило сохранить резервы для следующего этапа операции.';
for (const count of [1, 3] as const) it(`комментарий остаётся после звука на ${count} экранах и очищается перед следующим решением`, () => {
  const props = { window: count === 1 ? 0 : 1, count, state, settings: EXPO_DEFAULTS, send() {} };
  const v = render(<ExpoView {...props} ai={{ ...NO_AI, line: null, said: text }} />);
  expect(v.getByText(text)).toBeTruthy();
  v.rerender(<ExpoView {...props} ai={{ ...NO_AI, thinking: 'Готовим комментарий' }} />);
  expect(v.getByText('Готовим комментарий')).toBeTruthy();
  expect(v.queryByText(text)).toBeNull();
  v.rerender(<ExpoView {...props} state={{...state, phase: {...state.phase, kind:'turn', n:3, step:'choose'} as DirectorState['phase']}} ai={NO_AI} />);
  expect(v.queryByText(text)).toBeNull();
  expect(v.queryByText('Готовим комментарий')).toBeNull();
});
