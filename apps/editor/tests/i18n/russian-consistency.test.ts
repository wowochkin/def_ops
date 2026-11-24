// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { AsyncState, type AsyncStatus } from '../../src/modern/kshvi/shared/AsyncState';
import { formatBytes, formatDuration, formatNumber, formatRussianDateTime } from '../../src/modern/kshvi/shared/format';

afterEach(cleanup);

it('единообразно форматирует русские даты, числа, длительность и единицы', () => {
  expect(formatNumber(1234.5)).toBe('1 234,5');
  expect(formatRussianDateTime('2026-11-22T08:00:00.000Z')).toBe('22.11.2026, 08:00:00');
  expect(formatDuration(999)).toBe('999 мс');
  expect(formatDuration(1500)).toBe('1,5 с');
  expect(formatDuration(90_000)).toBe('1,5 мин');
  expect(formatBytes(1024)).toBe('1 КиБ');
  expect(formatBytes(1024 ** 2)).toBe('1 МиБ');
});

it('показывает содержательные русские состояния вместо технических кодов', () => {
  const statuses: AsyncStatus[] = ['loading', 'empty', 'forbidden', 'no-data', 'stale', 'partial-error', 'unavailable'];
  for (const status of statuses) {
    const { unmount } = render(AsyncState({ status }));
    const message = screen.getByRole('status').textContent ?? '';
    expect(message).toMatch(/[А-Яа-яЁё]/);
    expect(message).not.toContain(status);
    unmount();
  }
});

it('содержит русские руководства пользователя и технического дежурства', async () => {
  const user = await readFile('docs/kshvi-user-guide.md', 'utf8');
  const operations = await readFile('docs/kshvi-operations-guide.md', 'utf8');
  for (const phrase of ['Подготовка', 'Проведение', 'Разбор', 'Архив', 'Экспозиция', 'Роли']) expect(user).toContain(phrase);
  for (const phrase of ['Техническое дежурство', 'Резервные копии', 'Инциденты', 'Обновления', 'Восстановление']) expect(operations).toContain(phrase);
  expect(user).toContain('PDF');
  expect(user).toContain('DOCX');
  expect(operations).toContain('correlationId');
});
