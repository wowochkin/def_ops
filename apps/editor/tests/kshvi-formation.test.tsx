// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FormationStep } from '../src/modern/kshvi/preparation/FormationStep';

afterEach(cleanup);

const props = {
  plan: {
    id: 'План 1', orderVersion: 3,
    echelons: [{ id: 'Первый эшелон', readyAt: '08:00' }, { id: 'Второй эшелон', readyAt: '10:00' }],
    reserves: [{ id: 'Резерв', readyAt: '11:00' }],
    columns: [{ id: 'Колонна 1', routeId: 'Маршрут А', startAt: '07:00', endAt: '08:00' }],
    areas: [{ id: 'Район 1', kind: 'Район' }, { id: 'Рубеж 2', kind: 'Рубеж' }],
    controlPosts: [{ id: 'Основной ПУ' }, { id: 'Запасной ПУ' }],
  },
  issues: [{ code: 'ROUTE_CAPACITY_EXCEEDED', severity: 'ERROR' as const, message: 'Дорога занята в назначенный интервал' }],
  execution: {
    status: 'PARTIAL',
    positions: [{ elementId: 'Первый эшелон', travelledMeters: 600, remainingMeters: 400 }],
  },
};

it('показывает эшелоны, резерв, районы, рубежи, ПУ, маршруты и сроки', () => {
  render(<FormationStep {...props} />);
  expect(screen.getByRole('heading', { name: 'Оперативное построение' })).toBeTruthy();
  expect(screen.getByText('Версия приказа: 3')).toBeTruthy();
  expect(screen.getByText('Первый эшелон — готовность 08:00')).toBeTruthy();
  expect(screen.getByText('Резерв — готовность 11:00')).toBeTruthy();
  expect(screen.getByText('Рубеж 2: Рубеж')).toBeTruthy();
  expect(screen.getByText('Запасной ПУ')).toBeTruthy();
  expect(screen.getByText('Колонна 1: Маршрут А, 07:00–08:00')).toBeTruthy();
  expect(screen.getByText('Дорога занята в назначенный интервал')).toBeTruthy();
  expect(screen.getByText('Первый эшелон: пройдено 600 м, осталось 400 м')).toBeTruthy();
});

it('проверка плана не скрывает частичное исполнение', () => {
  const onValidate = vi.fn();
  render(<FormationStep {...props} onValidate={onValidate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить построение' }));
  expect(onValidate).toHaveBeenCalledOnce();
  expect(screen.getByText('Частичное исполнение')).toBeTruthy();
  expect(screen.getByText('Первый эшелон: пройдено 600 м, осталось 400 м')).toBeTruthy();
});
