// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KshviView } from '../src/modern/kshvi/KshviView';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/me')) return new Response(JSON.stringify({ userId: 'u1', organizationId: 'org1', activeRole: 'TRAINEE', authorities: ['exercise:read'] }), { status: 200 });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('показывает профиль автономии в подготовке и перехват в проведении', () => {
  render(<KshviView authorities={['exercise:read']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Подготовка' }));
  expect(screen.getByText('240 событий · 12 категорий · 48 операций')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Интенсивность разведки'), { target: { value: '0' } });
  expect(screen.getByText('Вероятностные события разведки отключены; плановые и реактивные сохранены')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Проведение' }));
  expect(screen.getByText('DELEGATED')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Перехватить управление' }));
  expect(screen.getByText('Мир не откатывается; дальнейшие действия подписывает человек')).toBeTruthy();
});
