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
it('authenticated menu changes saved settings and exits via callback', () => {
  let seconds = 0,
    exited = false;
  const view = render(
    <OperatorMenu
      settings={EXPO_DEFAULTS}
      onSave={async (s) => {
        seconds = s.timer.seconds;
      }}
      onClose={() => {}}
      onExit={() => {
        exited = true;
      }}
      onAction={() => {}}
    />,
  );
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
  fireEvent.change(view.getByLabelText('Время выбора, с'), { target: { value: '45' } });
  expect(seconds).toBe(45);
  fireEvent.click(view.getByRole('button', { name: 'Выйти в полный режим' }));
  expect(exited).toBe(true);
});
it('monitor order preserves separators until editing finishes', () => {
  let saved = EXPO_DEFAULTS;
  const view = render(
    <OperatorMenu
      settings={EXPO_DEFAULTS}
      onSave={async (s) => {
        saved = s;
      }}
      onClose={() => {}}
      onExit={() => {}}
      onAction={() => {}}
    />,
  );
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
  const order = view.getByLabelText('Порядок экранов (идентификаторы через запятую)') as HTMLInputElement;
  fireEvent.change(order, { target: { value: 'second,' } });
  expect(order.value).toBe('second,');
  fireEvent.change(order, { target: { value: 'second, first' } });
  fireEvent.blur(order);
  expect(saved.screens.order).toEqual(['second', 'first']);
});
it('number fields allow an incomplete value while typing', () => {
  const view = render(
    <OperatorMenu settings={EXPO_DEFAULTS} onSave={async () => {}} onClose={() => {}} onExit={() => {}} onAction={() => {}} />,
  );
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
  const input = view.getByLabelText('Время выбора, с') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '4' } });
  expect(input.value).toBe('4');
  fireEvent.change(input, { target: { value: '45' } });
  expect(input.value).toBe('45');
});
