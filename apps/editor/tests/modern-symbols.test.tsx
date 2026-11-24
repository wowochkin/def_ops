// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SymbolsView } from '../src/modern/symbols/SymbolsView';
import { getSymbol, symbolSet, type SymbolUsage } from '@def-ops/tactical-symbols';
import { sourceRegistry } from '@def-ops/tactical-symbols/source/browser';

afterEach(cleanup);

it('показывает происхождение и статус без учения', () => {
  render(<SymbolsView />);
  expect(screen.getByRole('heading', { name: 'Условные знаки' })).toBeTruthy();
  expect(screen.getByText('Источник и страница')).toBeTruthy();
  expect(screen.getAllByText('MAPPED').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Вставить на карту' })).toHaveProperty('disabled', true);
  expect(screen.getByText('Вариант 1')).toBeTruthy();
});

it('ищет танк и сравнивает вектор с исходным фрагментом', () => {
  render(<SymbolsView />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск знака' }), { target: { value: 'Танк' } });
  fireEvent.click(screen.getByRole('button', { name: /Танк/ }));
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

it('предоставляет главы, полные фильтры, модификаторы, топооснову и историю', () => {
  const commandPost = { ...getSymbol('source-1'), allowedModifierIds: ['main'], geometry: { version: 1, template: 'UNIT' as const, parameters: {} } };
  render(<SymbolsView set={{ ...symbolSet, symbols: [commandPost] }} />);
  const documentId = sourceRegistry.fragments.find(fragment => fragment.id === commandPost.source.fragmentId)!.documentId;
  fireEvent.change(screen.getByLabelText('Глава документа'), { target: { value: documentId } });
  fireEvent.change(screen.getByLabelText('Принадлежность'), { target: { value: 'UNKNOWN' } });
  fireEvent.change(screen.getByLabelText('Геометрия'), { target: { value: 'POINT' } });
  fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'MAPPED' } });
  fireEvent.change(screen.getByLabelText('Уровень'), { target: { value: 'ALL' } });
  expect(screen.getByRole('heading', { name: 'История версий' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Пример на топооснове' })).toBeTruthy();
  expect(screen.getByText('Модификаторы')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('main'));
  const vector = document.querySelector('[role="img"][aria-label="Векторный образец знака"]');
  expect(vector?.innerHTML).toContain('data-modifier="main"');
});

it('вставляет точную версию только при праве и ручном APPROVED', () => {
  const approved = { ...getSymbol('source-1'), status: 'APPROVED' as const };
  const approvedSet = { ...symbolSet, status: 'APPROVED' as const, symbols: [approved] };
  const usages: SymbolUsage[] = [];
  render(<SymbolsView set={approvedSet} canInsert onInsert={usage => usages.push(usage)} />);
  const button = screen.getByRole('button', { name: 'Вставить на карту' });
  expect(button).toHaveProperty('disabled', false);
  fireEvent.click(button);
  expect(usages).toEqual([{
    symbolId: approved.id, symbolVersion: approved.version, setVersion: approvedSet.version, geometryVersion: approved.geometry.version,
  }]);
});


it('показывает ошибку исходной страницы и позволяет повторить загрузку', () => {
  render(<SymbolsView />);
  const image = screen.getByRole('img', { name: 'Исходный фрагмент страницы' });
  fireEvent.error(image);
  expect(screen.getByRole('alert').textContent).toContain('не загрузилась');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  const repeated = screen.getByRole('img', { name: 'Исходный фрагмент страницы' });
  expect(repeated.getAttribute('src')).toContain('attempt=1');
  fireEvent.load(repeated);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('заменяет исходную надпись варианта без наложения второго текста', () => {
  render(<SymbolsView />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск знака' }), { target: { value: '68.6' } });
  fireEvent.click(screen.getByRole('button', { name: /68\.6/ }));
  fireEvent.change(screen.getByLabelText('Надпись 2мсд'), { target: { value: '3тд' } });
  const vector = document.querySelector('[role="img"][aria-label="Векторный образец знака"]');
  expect(vector?.innerHTML).toContain('data-inscription=');
  expect(vector?.innerHTML).toContain('3тд');
  expect(vector?.querySelectorAll('[data-inscription]')).toHaveLength(1);
  expect(vector?.innerHTML).toContain('font-weight="700"');
  expect(vector?.innerHTML).toContain('font-style="italic"');
});
