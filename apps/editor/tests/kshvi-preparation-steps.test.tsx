// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExerciseClient, type ExerciseCard } from '../src/modern/kshvi/kshvi-api';
import { ExercisePreparation } from '../src/modern/kshvi/preparation/PreparationWorkspace';

afterEach(cleanup);

it('показывает один шаг и ведёт от среды до запуска без простыни панелей', async () => {
  const client = new ExerciseClient({ fetch: vi.fn(async input => {
    const url = String(input);
    if (url.endsWith('/environment/atlases')) return Response.json([]);
    if (url.endsWith('/symbols/catalog')) return Response.json({ set: { id: 'ru-modern', version: 'v1', status: 'DRAFT', symbols: [], gaps: [] } });
    throw new Error(`Неожиданный запрос ${url}`);
  }) });
  const at = '2026-11-24T12:00:00Z';
  const card: ExerciseCard = {
    id: 'e1', title: 'Учение', payloadAccess: 'FULL', revision: 1, state: 'DRAFT', validation: 'NOT_RUN', readiness: 0,
    purpose: 'planned', scale: 'operational', ownerId: 'u1', startsAt: null, endsAt: null,
    createdAt: at, updatedAt: at, archivedAt: null, lastSessionId: null, sessions: [],
    revisions: [{ id: 'r1', exerciseId: 'e1', revision: 1, state: 'DRAFT', payload: {}, createdAt: at,
      createdBy: 'u1', supersedesId: null, sha256: 'a'.repeat(64) }],
  };
  render(<ExercisePreparation client={client} card={card} userId="u1" role="DIRECTOR" initialStep="environment"
    canRevise canStart={false} onCard={vi.fn()} onAccessLost={vi.fn()} onStart={vi.fn()} />);

  expect(await screen.findByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Среда/ }).getAttribute('aria-current')).toBe('step');
  expect(screen.queryByRole('heading', { name: 'Материально-техническое обеспечение' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Библиотека событий' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'Силы и МТО' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'События' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'Готовность' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  expect(screen.getByRole('heading', { name: 'Проверка перед запуском' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Запустить официальный сеанс' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Назад' }) as HTMLButtonElement).disabled).toBe(false);
});
