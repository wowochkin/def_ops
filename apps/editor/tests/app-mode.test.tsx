// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { AppWorkspace, AppModeSwitch, type AppMode } from '../src/AppMode';

const KEY = 'def_ops.app.mode';
const mounted = vi.fn();
function Historical({ active, onModeChange }: { active: boolean; onModeChange(mode: AppMode): void }) {
  const [draft, setDraft] = useState(() => { mounted(); return ''; });
  return <div data-testid="history" data-active={active}>
    <AppModeSwitch mode="historical" onChange={onModeChange} />
    <input aria-label="Черновик карты" value={draft} onChange={e => setDraft(e.target.value)} />
  </div>;
}
const workspace = () => <AppWorkspace historical={(active, onModeChange) => <Historical active={active} onModeChange={onModeChange} />} />;
beforeEach(() => { localStorage.clear(); mounted.mockClear(); });
afterEach(cleanup);

it('сохраняет выбор современного режима и не инициализирует исторический при следующем запуске', () => {
  const view = render(workspace());
  fireEvent.click(screen.getByRole('button', { name: 'Современный режим' }));
  expect(localStorage.getItem(KEY)).toBe('modern');
  expect(screen.getByRole('heading', { name: 'Современный режим' })).toBeTruthy();
  expect(screen.getByTestId('history').dataset.active).toBe('false');
  view.unmount(); mounted.mockClear();
  render(workspace());
  expect(mounted).not.toHaveBeenCalled();
  expect(screen.queryByTestId('history')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Исторический режим' }));
  expect(localStorage.getItem(KEY)).toBe('historical');
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('возвращается в историческое пространство с сохранённым состоянием', () => {
  render(workspace());
  fireEvent.change(screen.getByLabelText('Черновик карты'), { target: { value: 'Несохранённая карта' } });
  fireEvent.click(screen.getByRole('button', { name: 'Современный режим' }));
  fireEvent.click(screen.getByRole('button', { name: 'Исторический режим' }));
  expect((screen.getByLabelText('Черновик карты') as HTMLInputElement).value).toBe('Несохранённая карта');
  expect(screen.getByTestId('history').dataset.active).toBe('true');
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('не показывает неиспользуемую переигровку в верхней навигации', () => {
  render(workspace());
  fireEvent.click(screen.getByRole('button', { name: 'Современный режим' }));
  const nav = screen.getByRole('navigation', { name: 'Разделы современного режима' });
  expect(within(nav).queryByRole('button', { name: 'Переигровка' })).toBeNull();
  expect(within(nav).getAllByRole('button')).toHaveLength(5);
});

it('при неизвестном режиме открывает исторический', () => {
  localStorage.setItem(KEY, 'unknown');
  render(workspace());
  expect(screen.getByRole('button', { name: 'Исторический режим' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('heading', { name: 'Современный режим' })).toBeNull();
});
