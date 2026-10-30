// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { cornerHold, pinAttempt, operatorCombo } from '../src/expo/operator';
import { OperatorMenu } from '../src/expo/OperatorMenu';
import { EXPO_DEFAULTS } from '../src/expo/settings';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('corner hold opens pin only after uninterrupted three seconds', () => {
  vi.useFakeTimers();
  const el = document.createElement('div');
  document.body.append(el);
  let calls = 0;
  const off = cornerHold(el, () => calls++);
  fireEvent.pointerDown(el, { clientX: 20, clientY: 20, pointerId: 1 });
  vi.advanceTimersByTime(2000);
  expect(calls).toBe(0);
  fireEvent.pointerMove(el, { clientX: 100, clientY: 20, pointerId: 1 });
  vi.advanceTimersByTime(1000);
  expect(calls).toBe(0);
  fireEvent.pointerDown(el, { clientX: 20, clientY: 20, pointerId: 1 });
  vi.advanceTimersByTime(3000);
  expect(calls).toBe(1);
  off();
  el.remove();
});
it('combo opens pin and five failures lock it for sixty seconds', () => {
  expect(operatorCombo(new KeyboardEvent('keydown', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyO' }))).toBe(true);
  let lock = { failures: 0, until: 0 };
  for (let i = 0; i < 5; i++) lock = pinAttempt(lock, '1111', EXPO_DEFAULTS, 1000).lock;
  expect(pinAttempt(lock, '0000', EXPO_DEFAULTS, 60999).ok).toBe(false);
  expect(pinAttempt(lock, '0000', EXPO_DEFAULTS, 61000).ok).toBe(true);
});
const noop = () => {};
const enter = (view: ReturnType<typeof render>) => {
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
};
it('authenticated menu changes saved settings and exits via callback', () => {
  let seconds = 0;
  let exited = false;
  const view = render(
    <OperatorMenu
      settings={EXPO_DEFAULTS}
      onSave={async (s) => {
        seconds = s.timer.seconds;
      }}
      onClose={noop}
      onExit={() => {
        exited = true;
      }}
      onAction={noop}
    />,
  );
  enter(view);
  fireEvent.click(view.getByRole('button', { name: 'Время выбора, с: больше' }));
  expect(seconds).toBe(35);
  fireEvent.click(view.getByRole('button', { name: 'Выйти в полный режим' }));
  expect(exited).toBe(true);
});
it('settings are split into tabs', () => {
  const view = render(<OperatorMenu settings={EXPO_DEFAULTS} onSave={async () => {}} onClose={noop} onExit={noop} onAction={noop} />);
  enter(view);
  expect(view.getByRole('tab', { name: 'Сеанс' }).getAttribute('aria-selected')).toBe('true');
  expect(view.queryByLabelText('Новый ПИН (4–8 цифр)')).toBeNull();
  fireEvent.click(view.getByRole('tab', { name: 'Доступ' }));
  expect(view.getByLabelText('Новый ПИН (4–8 цифр)')).toBeTruthy();
  expect(view.queryByRole('group', { name: 'Время выбора, с' })).toBeNull();
});
it('screens tab saves monitor order', async () => {
  let saved = EXPO_DEFAULTS;
  const monitors = async () => [
    { id: 'a', name: 'Левый', x: 0, y: 0, width: 1, height: 1, scale: 1 },
    { id: 'b', name: 'Правый', x: 1, y: 0, width: 1, height: 1, scale: 1 },
  ];
  const view = render(
    <OperatorMenu
      settings={EXPO_DEFAULTS}
      monitors={monitors}
      onSave={async (s) => {
        saved = s;
      }}
      onClose={noop}
      onExit={noop}
      onAction={noop}
    />,
  );
  enter(view);
  fireEvent.click(view.getByRole('tab', { name: 'Экраны' }));
  fireEvent.click(await view.findByRole('button', { name: 'Правый: выше' }));
  expect(saved.screens.order).toEqual(['b', 'a']);
});
it('summary shows services in words', () => {
  const view = render(
    <OperatorMenu
      settings={EXPO_DEFAULTS}
      summary={{
        phase: 'Перелом 2 из 3 · Решение · на паузе',
        health: { core: 'ok', voice: 'fail', model: 'off', windows: 'ok' },
        note: null,
        stats: { sessions: 1, finished: 0, failures: 0 },
        screens: { open: 1, want: 1 },
      }}
      onSave={async () => {}}
      onClose={noop}
      onExit={noop}
      onAction={noop}
    />,
  );
  enter(view);
  expect(view.getByText('Голос — нет связи')).toBeTruthy();
  expect(view.getByText('Перелом 2 из 3 · Решение · на паузе')).toBeTruthy();
});
