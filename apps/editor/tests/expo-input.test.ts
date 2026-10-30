import { expect, it } from 'vitest';
import { affordances, keyToEvent } from '../src/expo/input';
import { initialState, step } from '../src/expo/director';
import { EXPO_DEFAULTS } from '../src/expo/settings';
it('touch has no hover and big targets', () => {
  expect(affordances('touch', true, 'ai')).toEqual({ hoverExpand: false, keys: false, minTarget: 96, voiceButton: true });
});
it('mouse expands on hover and voice button only with ai', () => {
  expect(affordances('mouse', true, 'noai')).toEqual({ hoverExpand: true, keys: false, minTarget: 64, voiceButton: false });
});
it('keyboard maps choices only during choose and replacement needs an alternative', () => {
  const phase = step(initialState(0), { t: 'jump', phase: 'turn' }, EXPO_DEFAULTS).state.phase;
  expect(keyToEvent('2', phase)).toBeNull();
  if (phase.kind !== 'turn') throw Error();
  const choose = { ...phase, step: 'choose' as const };
  expect(keyToEvent('2', choose)).toEqual({ t: 'choose', card: 1 });
  expect(keyToEvent('r', choose)).toBeNull();
  expect(keyToEvent('r', choose, { expanded: 2 })).toEqual({ t: 'replace', card: 2 });
  expect(keyToEvent('Escape', choose)).toBeNull();
});
