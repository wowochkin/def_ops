// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { KshviView } from '../src/modern/kshvi/KshviView';
import { ExerciseClient, type ExerciseCard } from '../src/modern/kshvi/kshvi-api';
import { createAutonomyProfile } from '../../../packages/kshvi-events/src/profile/autonomy-profile';

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

it('показывает методический профиль по умолчанию и предлагает открыть библиотеку при отсутствии сеанса', async () => {
  const client = new ExerciseClient({ fetch: async input => {
    const url = String(input);
    if (url.endsWith('/exercises')) return Response.json({ items: [card] });
    if (url.endsWith('/exercises/e1')) return Response.json(card);
    if (url.endsWith('/exercises/e1/autonomy/catalog')) return Response.json({
      manifest: { schemaVersion: 1, catalogId: 'test-catalog', version: 1, templates: [] },
      profile: createAutonomyProfile({ profileId: 'default-profile', level: 'MEDIUM' }), targets: [], items: [],
    });
    throw new Error(`Неожиданный запрос ${url}`);
  } });
  render(<KshviView client={client} role="DIRECTOR" authorities={['exercise:read', 'TRUTH_READ']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' }));
  fireEvent.click(await screen.findByRole('button', { name: 'События' }));
  expect(await screen.findByRole('heading', { name: 'Автономное наращивание' })).toBeTruthy();
  expect(screen.getByText('0 шаблонов · показано 0')).toBeTruthy();
  expect(screen.getByLabelText('Интенсивность разведки')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Проведение' }));
  expect(screen.getByRole('heading', { name: 'Активный сеанс не выбран' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Перехватить управление' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Открыть библиотеку' }));
  expect(await screen.findByRole('button', { name: 'Продолжить подготовку Учение' })).toBeTruthy();
});
