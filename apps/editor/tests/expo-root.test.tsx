// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { chooseRoot, expoWindowIndex, shouldStartExpo } from '../src/expo/routing';
import { lockdown } from '../src/expo/lockdown';
import { ExpoView } from '../src/expo/ExpoView';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import { initialState, step } from '../src/expo/director';
import { memoryBus } from '../src/expo/bus';
afterEach(cleanup);
it('window index from search', () => {
  expect(expoWindowIndex('?expo=2')).toBe(2);
  for (const q of ['?foo=1', '?expo=x', '?expo=-1', '?expo=3', '?expo=']) expect(expoWindowIndex(q)).toBeNull();
});
it('autostart enters expo and full mode untouched', () => {
  expect(shouldStartExpo({ ...EXPO_DEFAULTS, autostart: true }, '')).toBe(true);
  expect(chooseRoot('', EXPO_DEFAULTS)).toBe('shell');
  expect(chooseRoot('?expo=0', EXPO_DEFAULTS)).toBe('expo-host');
  expect(chooseRoot('?expo=2', { ...EXPO_DEFAULTS, autostart: true })).toBe('expo-view');
});
it('lockdown blocks quit keys and releases listeners on cleanup', () => {
  const off = lockdown(document, { operatorCombo: (e) => e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyO' });
  for (const opts of [
    { key: 'w', metaKey: true },
    { key: 'r', ctrlKey: true },
    { key: 'F5' },
    { key: 'F4', altKey: true },
    { key: 'Backspace' },
  ]) {
    const e = new KeyboardEvent('keydown', { ...opts, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  }
  const combo = new KeyboardEvent('keydown', { code: 'KeyO', ctrlKey: true, altKey: true, shiftKey: true, cancelable: true });
  document.dispatchEvent(combo);
  expect(combo.defaultPrevented).toBe(false);
  const menu = new Event('contextmenu', { cancelable: true });
  document.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
  off();
  const e = new Event('contextmenu', { cancelable: true });
  document.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
});
it('view shows roles of window', () => {
  const state = step(initialState(0), { t: 'jump', phase: 'turn' }, EXPO_DEFAULTS).state;
  for (const [window, title] of [
    [0, 'Штаб ИИ'],
    [1, 'Карта'],
    [2, 'Ход операции'],
  ] as const) {
    const view = render(<ExpoView window={window} state={state} settings={EXPO_DEFAULTS} count={3} send={() => {}} />);
    expect(view.getByRole('heading', { name: title })).toBeTruthy();
    cleanup();
  }
  const view = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} send={() => {}} />);
  for (const title of ['Карта', 'Штаб ИИ', 'Ход операции']) expect(view.getByRole('heading', { name: title })).toBeTruthy();
});
it('click sends input', () => {
  const [a, b] = memoryBus();
  const received: unknown[] = [];
  b.on((m) => received.push(m));
  const state = { ...initialState(1000), phase: { kind: 'attract' as const } };
  const view = render(<ExpoView window={0} state={state} settings={EXPO_DEFAULTS} count={1} send={(ev) => a.send({ k: 'input', ev })} />);
  fireEvent.click(view.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }));
  expect(received).toEqual([{ k: 'input', ev: { t: 'touch' } }]);
  a.close();
  b.close();
});
it('keys ignored outside profile and active keyboard profile chooses', () => {
  const p = step(initialState(0), { t: 'jump', phase: 'turn' }, EXPO_DEFAULTS).state;
  const state = step(p, { t: 'tick', now: 11000 }, EXPO_DEFAULTS).state;
  const events: unknown[] = [];
  const view = render(<ExpoView window={0} count={1} state={state} settings={EXPO_DEFAULTS} send={(e) => events.push(e)} />);
  fireEvent.keyDown(document, { key: '2' });
  expect(events).toEqual([]);
  view.rerender(
    <ExpoView window={0} count={1} state={state} settings={{ ...EXPO_DEFAULTS, input: 'mouse-keyboard' }} send={(e) => events.push(e)} />,
  );
  fireEvent.keyDown(document, { key: '2' });
  expect(events).toEqual([{ t: 'choose', card: 1 }]);
});
