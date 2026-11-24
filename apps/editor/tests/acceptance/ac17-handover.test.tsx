// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConductShell } from '../../src/modern/kshvi/conduct/shared/ConductShell';
import { overviewProjection } from '../../src/modern/kshvi/conduct/shared/overviewProjection';
import { ExerciseClient } from '../../src/modern/kshvi/kshvi-api';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('def_ops.kshvi.local-editor', '{"title":"Скрытый замысел"}');
  localStorage.setItem('def_ops.modern.weather.region', '{"bounds":[1,2,3,4]}');
  sessionStorage.setItem('def_ops.kshvi.csrf:/api/kshvi', 'secret-csrf');
  sessionStorage.setItem('def_ops.kshvi.workspace.exercise', '{"id":"secret-exercise"}');
  sessionStorage.setItem('kshvi.projection', '{"secret":true}');
});
afterEach(cleanup);

it('AC-17: передача устройства удаляет приватные ключи и показывает нейтральный экран', async () => {
  const onHandover = vi.fn();
  render(<ConductShell title="Скрытый замысел" projection={overviewProjection} onHandover={onHandover}><div /></ConductShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Передать рабочее место' }));
  const next = await screen.findByRole('button', { name: 'Подтвердить новую роль' });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  expect(document.body.textContent).not.toContain('Скрытый замысел');
  for (const storage of [localStorage, sessionStorage]) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '');
    expect(keys.filter(key => key.startsWith('kshvi.') || key.startsWith('def_ops.kshvi.'))).toEqual([]);
  }
  expect(localStorage.getItem('def_ops.modern.weather.region')).toBe('{"bounds":[1,2,3,4]}');
  fireEvent.click(next);
  expect(onHandover).toHaveBeenCalledTimes(1);
});


it('AC-17: выход отзывает серверную сессию и удаляет CSRF из окна', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/login')) return Response.json({ csrfToken: 'secret-csrf', participant: { userId: 'u1', activeRole: null, organizationId: 'org1', authorities: [] }, roles: [{ id: 'role-1', role: 'LEADER', sideId: 'blue' }] });
    if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
    throw new Error(`Неожиданный запрос ${url}`);
  });
  const client = new ExerciseClient({ fetch: fetcher });
  await client.login('leader', 'secret');
  expect(sessionStorage.getItem('def_ops.kshvi.csrf:/api/kshvi')).toBe('secret-csrf');
  await client.logout();
  const logoutCall = calls.find(call => call.url.endsWith('/auth/logout'));
  expect(logoutCall?.init?.method).toBe('POST');
  expect(logoutCall?.init?.headers).toMatchObject({ 'X-CSRF-Token': 'secret-csrf' });
  expect(sessionStorage.getItem('def_ops.kshvi.csrf:/api/kshvi')).toBeNull();
});
