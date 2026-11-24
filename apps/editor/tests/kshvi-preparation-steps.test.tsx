// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExerciseClient } from '../src/modern/kshvi/kshvi-api';
import { PreparationWorkspace } from '../src/modern/kshvi/preparation/PreparationWorkspace';

afterEach(cleanup);

it('показывает один шаг и ведёт от среды до запуска без простыни панелей', async () => {
  const client = new ExerciseClient({ fetch: vi.fn(async input => {
    const url = String(input);
    if (url.endsWith('/environment/atlases')) return Response.json([]);
    if (url.endsWith('/symbols/catalog')) return Response.json({ set: { id: 'ru-modern', version: 'v1', status: 'DRAFT', symbols: [], gaps: [] } });
    throw new Error(`Неожиданный запрос ${url}`);
  }) });
  render(<PreparationWorkspace client={client} exerciseId="e1" revision={1} authorId="u1" truthRole="DIRECTOR" onRevision={vi.fn()} exerciseState="DRAFT" />);

  expect(await screen.findByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Среда/ }).getAttribute('aria-current')).toBe('step');
  expect(screen.queryByRole('heading', { name: 'Материально-техническое обеспечение' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Библиотека событий' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'Материально-техническое обеспечение' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'Библиотека событий' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'Этап обеспечения боевой готовности' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'Проверка перед запуском' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Запустить официальный сеанс' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Назад' }) as HTMLButtonElement).disabled).toBe(false);
});
