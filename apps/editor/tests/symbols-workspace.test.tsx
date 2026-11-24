// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SymbolsView } from '../src/modern/symbols/SymbolsView';

afterEach(cleanup);

it('переключается между знаками и исходными документами с крупной страницей', () => {
  render(<SymbolsView />);
  expect(screen.getByRole('button', { name: 'По документам' })).toBeTruthy();
  expect(screen.getAllByText('Вектор сопоставлен').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: 'По документам' }));
  expect(screen.getByText('Оглавление исходных документов')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /01ПУ\.doc/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Страница 1' }));
  expect(screen.getByRole('img', { name: 'Исходная страница 1 документа 01ПУ.doc' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Увеличить' })).toBeTruthy();
});
