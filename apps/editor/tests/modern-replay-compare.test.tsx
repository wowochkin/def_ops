// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { chooseDateTime } from './helpers/date-time';
import { afterEach, expect, it } from 'vitest';
import type { SavedSession } from '../src/modern/replay/archive';
import { CompareSessions } from '../src/modern/replay/CompareSessions';
import { createSession, submitDecision, voteFinish, type Scenario, type Session } from '../src/modern/replay/session';

afterEach(cleanup);
const time = (hour: number) => `2030-05-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
const config: Scenario = {
  title: 'Архив редакции', area: 'Читальный зал', start: time(0), end: time(12), periodHours: 6,
  disclosure: 'immediate', sides: { a: { country: 'AA', objective: 'Задача А' }, b: { country: 'BB', objective: 'Задача Б' } },
  choices: [{ id: 'stop', label: 'Закрыть каталог' }, { id: 'read', label: 'Читать' }],
  events: [{ at: time(1), text: 'Оглавление готово', audience: 'b', reportAt: { b: time(4) } },
    { at: time(3), text: 'Каталог закрыт', ends: true, audience: 'none', when: { a: 'stop' } }],
};

function archive(id: string, session: Session, original = 'base'): SavedSession {
  return { session, summary: { id, original, title: config.title, area: config.area, status: session.status,
    updated: time(12), disclosed: true, periodCount: session.periods.length, revision: 1 } };
}

function play(session: Session, choice: string | null, note: string): Session {
  const a = submitDecision(session, 'a', session.now, { choice, note });
  return submitDecision(a, 'b', a.now, { choice: null });
}

function finishWithNote(note: string, scenario = config) {
  const start = createSession(scenario);
  const pending = submitDecision(start, 'a', start.now, { choice: 'read', note });
  return voteFinish(voteFinish(pending, 'a'), 'b');
}

it('сопоставляет записи незакрытого периода исходного сеанса и повтора', () => {
  render(<CompareSessions left={archive('base', finishWithNote('Первый лист'))}
    right={archive('again', finishWithNote('Второй лист'))} onBack={() => {}} />);
  expect(screen.getByRole('columnheader', { name: /Исходный сеанс/ })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: /Повтор/ })).toBeTruthy();
  expect(screen.getByText('Первый лист')).toBeTruthy();
  expect(screen.getByText('Второй лист')).toBeTruthy();
  expect(screen.getAllByText('Незакрытый период')).toHaveLength(2);
});

it('ограничивает ручной срез временем остановки каждой попытки и не показывает будущих решений или событий', () => {
  const earlier = play(createSession(config), 'stop', 'Решение в начале');
  const later = play(play(createSession(config), 'read', ''), null, 'Запись второго периода');
  render(<CompareSessions left={archive('base', earlier)} right={archive('again', later)} onBack={() => {}} />);
  const setTime = (value: string) => chooseDateTime('Момент сравнения (UTC)', '2030-05-01T' + value);
  expect(screen.getByText('Запись второго периода')).toBeTruthy();
  setTime('00:30');
  expect(screen.queryByText(/Оглавление готово/)).toBeNull();
  expect(screen.queryByText(/Каталог закрыт/)).toBeNull();
  expect(screen.queryByText('Запись второго периода')).toBeNull();
  setTime('02:30');
  expect(screen.getAllByText(/Оглавление готово/)).toHaveLength(2);
  expect(screen.getAllByText(/не доставлено/)).toHaveLength(2);
  setTime('05:15');
  const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
  expect(cells[0].textContent).toContain('не доставлено');
  expect(cells[1].textContent).toContain('Сторона Б · получено');
  expect(screen.queryByText('Запись второго периода')).toBeNull();
});

it('проверяет фактическое раскрытие обеих попыток, их общий исходный сеанс и разные идентификаторы', () => {
  const open = archive('base', finishWithNote('Частный лист'));
  const privateRow = archive('again', finishWithNote('Скрытая запись', { ...config, disclosure: 'mutual' }));
  const view = render(<CompareSessions left={open} right={privateRow} onBack={() => {}} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(document.body.textContent).not.toContain('Скрытая запись');
  expect(document.body.textContent).not.toContain('Частный лист');
  view.rerender(<CompareSessions left={open} right={archive('other', finishWithNote('Чужой сценарий'), 'other')} onBack={() => {}} />);
  expect(screen.queryByRole('table')).toBeNull();
  view.rerender(<CompareSessions left={open} right={open} onBack={() => {}} />);
  expect(screen.getByRole('alert')).toBeTruthy();
});
