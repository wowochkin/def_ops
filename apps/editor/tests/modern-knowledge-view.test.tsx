// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ModernKnowledgeView } from '../src/modern/ModernKnowledgeView';

afterEach(cleanup);

it('показывает категории техники и фильтрует каталог выбранной категорией', () => {
  render(<ModernKnowledgeView />);
  fireEvent.click(screen.getByRole('button', { name: /Германия/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Техника' }));
  const categories = screen.getByRole('navigation', { name: 'Категории техники' });
  fireEvent.click(within(categories).getByRole('button', { name: /^БМП / }));
  expect(screen.getByRole('heading', { name: 'Puma' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Leopard 2' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Финляндия/ }));
  expect(within(categories).getByRole('button', { name: /^Все категории/ }).getAttribute('aria-pressed')).toBe('true');
});

it('показывает страны и национальную структуру, включая самостоятельные рода', () => {
  render(<ModernKnowledgeView />);
  const countries = screen.getByRole('navigation', { name: 'Страны базы знаний' });
  expect(within(countries).getAllByRole('button')).toHaveLength(15);
  fireEvent.click(within(countries).getByRole('button', { name: /Украина/ }));
  const tree = screen.getByRole('navigation', { name: 'Виды ВС и рода войск' });
  fireEvent.click(within(tree).getByRole('button', { name: /Силы беспилотных систем/ }));
  expect(screen.getByRole('heading', { name: 'Силы беспилотных систем' })).toBeTruthy();
  expect(within(screen.getByRole('article')).getByText('Отдельный род войск или сил')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Про нас/ }).getAttribute('href')).toBe('https://mod.gov.ua/pro-nas');
});

it('ищет представителей техники по русскому классу в пределах выбранной страны', () => {
  render(<ModernKnowledgeView />);
  fireEvent.click(screen.getByRole('button', { name: /Германия/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Техника' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'БМП' } });
  expect(screen.getByRole('heading', { name: 'Puma' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Leopard 2' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Bradley M2A4' })).toBeNull();
  expect(screen.getAllByText(/43\s*000 кг/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Допуск к расчётной модели не выполнен/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Не заполнено полей:/).length).toBeGreaterThan(0);
});

it('показывает незаполненные иерархии и период внешнего источника без выдачи их за подтверждённые', () => {
  render(<ModernKnowledgeView />);
  fireEvent.click(screen.getByRole('button', { name: /Индия/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Организационные уровни' }));
  expect(screen.getAllByText('Национальная схема ещё не собрана').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: /КНДР/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Источники' }));
  expect(screen.getAllByText(/Период сведений: 2021/).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Внешняя государственная оценка').length).toBeGreaterThan(0);
});
