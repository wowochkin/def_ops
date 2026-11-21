// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SymbolsView } from '../src/modern/symbols/SymbolsView';

afterEach(cleanup);

it('показывает происхождение и статус без учения', () => {
  render(<SymbolsView />);
  expect(screen.getByRole('heading', { name: 'Условные знаки' })).toBeTruthy();
  expect(screen.getByText('Источник и страница')).toBeTruthy();
  expect(screen.getAllByText('MAPPED').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Вставить на карту' })).toHaveProperty('disabled', true);
});

it('ищет переправу и сравнивает вектор с исходным фрагментом', () => {
  render(<SymbolsView />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск знака' }), { target: { value: 'понтон' } });
  fireEvent.click(screen.getByRole('button', { name: /Понтонная переправа/ }));
  expect(screen.getByRole('img', { name: 'Векторный образец знака' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Исходный фрагмент страницы' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Подпись сверху'), { target: { value: 'Р-17' } });
  expect(screen.getByDisplayValue('Р-17')).toBeTruthy();
});

it('показывает покрытие исходных документов и отсутствие утверждения', () => {
  render(<SymbolsView />);
  expect(screen.getByText('29 документов · 2 шрифта · 83 фрагмента')).toBeTruthy();
  expect(screen.getByText('Методическое утверждение ещё не выполнено')).toBeTruthy();
});


it('не выводит неопределённую подпись при пустом поле', () => {
  render(<SymbolsView />);
  const vector = document.querySelector('[role="img"][aria-label="Векторный образец знака"]');
  expect(vector?.innerHTML).not.toContain('undefined');
});
