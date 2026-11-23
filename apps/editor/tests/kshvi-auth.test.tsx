// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExerciseClient } from '../src/modern/kshvi/kshvi-api';
import { KshviView } from '../src/modern/kshvi/KshviView';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('проводит вход, выбирает серверную роль и открывает библиотеку с её полномочиями', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/me')) return json({ error: { message: 'Требуется вход в систему' } }, 401);
    if (url.endsWith('/auth/login')) return json({
      csrfToken: 'csrf-from-server', participant: { userId: 'local-leader', activeRole: null, organizationId: 'default', authorities: [] },
      roles: [{ id: 'local-director-role', role: 'DIRECTOR', sideId: null }],
    });
    if (url.endsWith('/auth/role')) return json({ userId: 'local-leader', activeRole: 'DIRECTOR', organizationId: 'default', authorities: ['exercise:read', 'exercise:create'] });
    if (url.endsWith('/exercises')) return json({ items: [] });
    throw new Error(`Неожиданный запрос ${init?.method ?? 'GET'} ${url}`);
  });
  render(<KshviView client={new ExerciseClient({ fetch: fetcher })} />);

  fireEvent.change(await screen.findByLabelText('Имя пользователя'), { target: { value: 'local-leader' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'local-kshvi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

  expect(await screen.findByRole('button', { name: 'Создать учение' })).toBeTruthy();
  const roleCall = calls.find(call => call.url.endsWith('/auth/role'));
  expect(roleCall?.init?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf-from-server' });
  expect(JSON.parse(String(roleCall?.init?.body))).toEqual({ roleId: 'local-director-role' });
  await waitFor(() => expect(calls.some(call => call.url.endsWith('/exercises'))).toBe(true));
});


it('восстанавливает CSRF в том же окне после пересоздания клиента', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/login')) return json({
      csrfToken: 'csrf-from-server', participant: { userId: 'local-leader', activeRole: null, organizationId: 'default', authorities: [] },
      roles: [{ id: 'local-director-role', role: 'DIRECTOR', sideId: null }],
    });
    if (url.endsWith('/exercises')) return json({ id: 'e1' }, 201);
    throw new Error(`Неожиданный запрос ${init?.method ?? 'GET'} ${url}`);
  });
  await new ExerciseClient({ fetch: fetcher }).login('local-leader', 'local-kshvi');
  await new ExerciseClient({ fetch: fetcher }).create({ title: 'Учение', purpose: 'planned', scale: 'operational' });
  expect(calls.at(-1)?.init?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf-from-server' });
});
