// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExerciseClient } from '../src/modern/kshvi/kshvi-api';
import { KshviView } from '../src/modern/kshvi/KshviView';

const exercise = { id: 'e1', title: 'Учение с картой', revision: 2, payloadAccess: 'FULL', state: 'DRAFT', validation: 'NOT_RUN', revisions: [{ id: 'r2', revision: 2, payload: {} }], sessions: [] };
const client = new ExerciseClient({ fetch: vi.fn(async input => {
  const url = String(input);
  if (url.endsWith('/exercises')) return Response.json({ items: [exercise] });
  if (url.endsWith('/exercises/e1')) return Response.json(exercise);
  if (url.endsWith('/environment/atlases')) return Response.json([]);
  if (url.endsWith('/symbols/catalog')) return Response.json({ set: { id: 'ru-modern', version: 'v1', status: 'DRAFT', symbols: [], gaps: [] } });
  throw new Error(`Неожиданный запрос ${url}`);
}) });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

it('сохраняет ссылку на рабочее учение при повторном монтировании и подтверждает её сервером', async () => {
  const first = render(<KshviView client={client} authorities={['exercise:read', 'exercise:revise']} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Продолжить подготовку Учение с картой' }));
  expect(await screen.findByRole('heading', { name: 'Учение с картой' })).toBeTruthy();
  first.unmount();

  render(<KshviView client={client} authorities={['exercise:read', 'exercise:revise']} />);
  expect(await screen.findByRole('heading', { name: 'Учение с картой' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Карта и погода исходной обстановки' })).toBeTruthy();
});
