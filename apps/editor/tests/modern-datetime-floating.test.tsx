// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DateTimeField } from '../src/modern/DateTimeField';
afterEach(cleanup);

it('календарь в прокручиваемом инспекторе позволяет выбрать дату и закрывается без отмены нанесения', () => {
  function Inspector() {
    const [value, setValue] = useState('2030-01-01T00:00');
    return <DateTimeField floating id="date" label="Начало объекта" value={value} onChange={setValue} />;
  }
  const escape = vi.fn();
  const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') escape(); };
  window.addEventListener('keydown', handler);
  try {
    const { container } = render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Начало объекта' }));
    expect(container.contains(screen.getByRole('dialog'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '2 января 2030' }));
    expect(screen.getByRole('button', { name: 'Начало объекта' }).textContent).toContain('02.01.2030');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(escape).not.toHaveBeenCalled();
  } finally { window.removeEventListener('keydown', handler); }
});

it('блокировка инспектора закрывает вынесенный календарь и запрещает повторное открытие', () => {
  const props = { floating: true, id: 'date', label: 'Начало объекта', value: '2030-01-01T00:00', onChange: vi.fn() };
  const view = render(<DateTimeField {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Начало объекта' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  view.rerender(<DateTimeField {...props} disabled />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByRole('button', { name: 'Начало объекта' }) as HTMLButtonElement).disabled).toBe(true);
});
