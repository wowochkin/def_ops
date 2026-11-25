// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { KshviView } from '../src/modern/kshvi/KshviView';
import { ExerciseClient, type ExerciseCard } from '../src/modern/kshvi/kshvi-api';

const now = '2030-01-01T10:00:00Z';
const card: ExerciseCard = {
  id: 'e1', title: 'Учение', purpose: 'planned', scale: 'operational', ownerId: 'leader',
  revision: 1, state: 'DRAFT', validation: 'NOT_RUN', readiness: 0, payloadAccess: 'FULL',
  createdAt: now, updatedAt: now, startsAt: null, endsAt: null, archivedAt: null, lastSessionId: null,
  sessions: [],
  revisions: [{
    id: 'r1', exerciseId: 'e1', revision: 1, state: 'DRAFT', payload: {}, sha256: 'a'.repeat(64),
    createdAt: now, createdBy: 'leader', supersedesId: null,
  }],
};

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

it('показывает отсутствие серверного профиля в подготовке и предлагает открыть библиотеку при отсутствии сеанса', async () => {
  const client = new ExerciseClient({ fetch: async input => {
    const url = String(input);
    if (url.endsWith('/exercises')) return Response.json({ items: [card] });
    if (url.endsWith('/exercises/e1')) return Response.json(card);
    throw new Error(`Неожиданный запрос ${url}`);
  } });
  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'TRUTH_READ']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  fireEvent.click(await screen.findByRole('button', { name: 'События' }));
  expect(screen.getByText(/Профиль событий ещё не задан/)).toBeTruthy();
  expect(screen.queryByText('240 событий · 12 категорий · 48 операций')).toBeNull();
  expect(screen.queryByLabelText('Интенсивность разведки')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Проведение' }));
  expect(screen.getByRole('heading', { name: 'Активный сеанс не выбран' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Перехватить управление' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Открыть библиотеку' }));
  expect(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' })).toBeTruthy();
});
