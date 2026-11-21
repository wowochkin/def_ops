// @vitest-environment happy-dom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSession, restartSession, submitDecision, type Scenario, type Session } from '../src/modern/replay/session';
import { SessionView } from '../src/modern/replay/SessionView';
import { journalText } from '../src/modern/replay/journal-text';

afterEach(() => { cleanup(); localStorage.clear(); });

const scenario: Scenario = {
  title: 'Редакционный совет', area: 'Условный город',
  start: '2030-02-01T00:00:00Z', end: '2030-02-01T06:00:00Z',
  periodHours: 6, disclosure: 'mutual',
  sides: {
    a: { country: 'Север', objective: 'Сверить опись архива', materials: [
      { id: 'base', label: 'Ведомость архива', required: true },
      { id: 'option', label: 'Карточка фонда', required: false },
    ] },
    b: { country: 'Юг', objective: 'Сверить библиотечный каталог' },
  },
  choices: [{ id: 'read', label: 'Прочесть приложение' }],
  events: [
    { at: '2030-02-01T03:00:00Z', audience: 'a', text: 'Найдена новая опись', announcement: 'Из архива' },
    { at: '2030-02-01T04:00:00Z', audience: 'none', text: 'Скрытое событие', announcement: 'Метка автора' },
  ],
};

function Viewer({ initial, id }: { initial: Session; id?: string }) {
  const [session, setSession] = useState(initial);
  return <SessionView session={session} sessionId={id} onChange={async updated => setSession(updated)} onBack={() => {}} onRepeat={async () => {}} />;
}

const click = async (name: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
};

it('скрывает личные данные при передаче устройства и после повторного открытия', async () => {
  const initial = createSession(scenario);
  const view = render(<Viewer initial={initial} />);
  expect(document.body.textContent).not.toContain('Сверить опись архива');
  expect(document.body.textContent).not.toContain('Ведомость архива');
  await click('Открыть экран стороны А');
  expect(screen.getByText('Сверить опись архива')).toBeTruthy();
  expect(document.body.textContent).not.toContain('Сверить библиотечный каталог');
  fireEvent.click(screen.getByLabelText('Карточка фонда'));
  fireEvent.click(screen.getByLabelText('Прочесть приложение'));
  fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Моя личная заметка' } });
  await click('Сохранить и передать устройство');
  expect(document.body.textContent).not.toContain('Моя личная заметка');
  expect(document.body.textContent).not.toContain('Сверить библиотечный каталог');
  await click('Открыть экран стороны Б');
  expect(screen.getByText('Сверить библиотечный каталог')).toBeTruthy();
  expect(document.body.textContent).not.toContain('Моя личная заметка');
  expect(document.body.textContent).not.toContain('Карточка фонда');
  view.unmount();

  const pending = submitDecision(initial, 'a', initial.now, { choice: 'read', note: 'Моя личная заметка', materialIds: ['base'] });
  render(<Viewer initial={pending} />);
  expect(screen.getByRole('button', { name: 'Открыть экран стороны Б' })).toBeTruthy();
  expect(document.body.textContent).not.toContain('Сверить библиотечный каталог');
  expect(document.body.textContent).not.toContain('Моя личная заметка');
});

function finished(disclosure: Scenario['disclosure']) {
  const initial = createSession({ ...scenario, disclosure });
  const first = submitDecision(initial, 'a', initial.now, { choice: 'read', note: 'Запись севера', materialIds: ['base'] });
  return submitDecision(first, 'b', first.now, { choice: 'read', note: 'Запись юга' });
}

it('показывает общий журнал только после двух личных согласий и открытия с нейтрального экрана', async () => {
  render(<Viewer initial={finished('mutual')} />);
  await click('Открыть экран стороны А');
  expect(screen.getByText('Запись севера')).toBeTruthy();
  expect(document.body.textContent).toContain('Найдена новая опись');
  expect(document.body.textContent).toContain('Из архива');
  expect(document.body.textContent).not.toContain('Метка автора');
  expect(document.body.textContent).not.toContain('Запись юга');
  await click('Разрешить общий разбор');
  expect(document.body.textContent).not.toContain('Запись севера');
  expect(screen.queryByRole('button', { name: 'Открыть общий разбор' })).toBeNull();
  await click('Открыть экран стороны Б');
  expect(screen.getByText('Запись юга')).toBeTruthy();
  expect(document.body.textContent).not.toContain('Из архива');
  expect(document.body.textContent).not.toContain('Найдена новая опись');
  expect(document.body.textContent).not.toContain('Метка автора');
  expect(document.body.textContent).not.toContain('Запись севера');
  await click('Разрешить общий разбор');
  expect(document.body.textContent).not.toContain('Запись юга');
  await click('Открыть общий разбор');
  expect(screen.getByText('Запись севера')).toBeTruthy();
  expect(screen.getByText('Запись юга')).toBeTruthy();
});

it('открывает немедленный общий разбор с нейтрального экрана без голосований', async () => {
  render(<Viewer initial={finished('immediate')} />);
  expect(document.body.textContent).not.toContain('Запись севера');
  await click('Открыть общий разбор');
  expect(screen.getByText('Запись севера')).toBeTruthy();
  expect(screen.getByText('Запись юга')).toBeTruthy();
});

it('оставляет запись на личном экране при ошибке сохранения и блокирует повторную отправку', async () => {
  let complete!: (cause: Error) => void;
  const onChange = vi.fn(() => new Promise<void>((_, reject) => { complete = reject; }));
  render(<SessionView session={createSession(scenario)} onChange={onChange} onBack={() => {}} onRepeat={async () => {}} />);
  await click('Открыть экран стороны А');
  fireEvent.click(screen.getByLabelText('Прочесть приложение'));
  fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Черновик останется здесь' } });
  await click('Сохранить и передать устройство');
  await click('Сохранить и передать устройство');
  expect(onChange).toHaveBeenCalledTimes(1);
  await act(async () => complete(new Error('Не хватает свободного места')));
  expect(screen.getByRole('alert').textContent).toBe('Не хватает свободного места');
  expect((screen.getByLabelText('Комментарий') as HTMLTextAreaElement).value).toBe('Черновик останется здесь');
  expect((screen.getByRole('button', { name: 'Сохранить и передать устройство' }) as HTMLButtonElement).disabled).toBe(false);
});

it('выгружает только события и документы владельца личного журнала, пока общий разбор закрыт', () => {
  const session = finished('mutual');
  const personal = journalText(session, 'a');
  expect(personal).toContain('Сверить опись архива');
  expect(personal).toContain('Ведомость архива');
  expect(personal).toContain('Запись севера');
  expect(personal).toContain('Найдена новая опись');
  expect(personal).not.toContain('Сверить библиотечный каталог');
  expect(personal).not.toContain('Запись юга');
  expect(personal).not.toContain('Скрытое событие');
  expect(personal).not.toContain('Метка автора');
  expect(() => journalText(session, 'joint')).toThrow();
});

it('при повторе показывает зафиксированный личный набор карточек', async () => {
  const initial = createSession(scenario);
  const first = submitDecision(initial, 'a', initial.now, { choice: 'read', note: '', materialIds: ['base', 'option'] });
  const done = submitDecision(first, 'b', first.now, { choice: 'read', note: '' });
  render(<Viewer initial={restartSession(done)} />);
  await click('Открыть экран стороны А');
  const selected = screen.getByLabelText('Карточка фонда') as HTMLInputElement;
  expect(selected.checked).toBe(true);
  expect(selected.disabled).toBe(true);
  expect(screen.getByText('Подборка сохранена из исходного сеанса.')).toBeTruthy();
});

it('восстанавливает черновик только в своём сеансе на личном экране и удаляет его после сохранения', async () => {
  const initial = createSession(scenario);
  const view = render(<Viewer initial={initial} id="первый" />);
  await click('Открыть экран стороны А');
  fireEvent.click(screen.getByLabelText('Прочесть приложение'));
  fireEvent.click(screen.getByLabelText('Карточка фонда'));
  fireEvent.change(screen.getByLabelText('Форма записи'), { target: { value: 'separate' } });
  fireEvent.change(screen.getByLabelText('Записи по одной на строке'), { target: { value: 'Мой отдельный черновик' } });
  view.unmount();

  const other = render(<Viewer initial={initial} id="второй" />);
  await click('Открыть экран стороны А');
  expect((screen.getByLabelText('Комментарий') as HTMLTextAreaElement).value).toBe('');
  other.unmount();

  render(<Viewer initial={initial} id="первый" />);
  expect(document.body.innerHTML).not.toContain('Мой отдельный черновик');
  await click('Открыть экран стороны А');
  expect((screen.getByLabelText('Карточка фонда') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Записи по одной на строке') as HTMLTextAreaElement).value).toBe('Мой отдельный черновик');
  await click('Передать устройство стороне Б');
  await click('Открыть экран стороны Б');
  expect((screen.getByLabelText('Комментарий') as HTMLTextAreaElement).value).toBe('');
  expect(document.body.innerHTML).not.toContain('Мой отдельный черновик');
  await click('Передать устройство стороне А');
  await click('Открыть экран стороны А');
  await click('Сохранить и передать устройство');
  expect(localStorage.length).toBe(0);
  expect(document.body.innerHTML).not.toContain('Мой отдельный черновик');
});

it('меняет подборку при личном выборе страны, фиксирует её для повтора', async () => {
  const source = { ...scenario, sides: { ...scenario.sides, a: { ...scenario.sides.a, alternatives: [
    { country: 'Острова', materials: [{ id: 'island', required: true, label: 'Островная библиотека' }] },
  ] } } };
  const initial = createSession(source);
  const view = render(<Viewer initial={initial} id="досье" />);
  await click('Открыть экран стороны А');
  fireEvent.click(screen.getByLabelText('Карточка фонда'));
  fireEvent.change(screen.getByLabelText('Страна стороны'), { target: { value: 'Острова' } });
  expect(screen.queryByText('Карточка фонда')).toBeNull();
  expect((screen.getByLabelText('Островная библиотека') as HTMLInputElement).checked).toBe(true);
  view.unmount();
  render(<Viewer initial={initial} id="досье" />);
  await click('Открыть экран стороны А');
  expect((screen.getByLabelText('Страна стороны') as HTMLSelectElement).value).toBe('Острова');
  await click('Передать устройство стороне Б');
  await click('Открыть экран стороны Б');
  expect(screen.queryByText('Островная библиотека')).toBeNull();
  cleanup();

  const first = submitDecision(initial, 'a', initial.now, { country: 'Острова', materialIds: ['island'], choice: 'read', note: '' });
  const done = submitDecision(first, 'b', first.now, { choice: 'read', note: '' });
  render(<Viewer initial={restartSession(done)} />);
  await click('Открыть экран стороны А');
  expect(screen.queryByLabelText('Страна стороны')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Острова' })).toBeTruthy();
  expect((screen.getByLabelText('Островная библиотека') as HTMLInputElement).disabled).toBe(true);
});

it('различает время события и получения известия на шкале общего разбора', async () => {
  const initial = createSession({ ...scenario, disclosure: 'immediate', events: [{
    at: '2030-02-01T01:00:00Z', audience: 'both', text: 'Поступила опись',
    reportAt: { b: '2030-02-01T05:00:00Z' },
  }] });
  const first = submitDecision(initial, 'a', initial.now, { choice: 'read', note: 'Мой текст', materialIds: ['base'] });
  render(<Viewer initial={submitDecision(first, 'b', first.now, { choice: 'read', note: 'Текст второй стороны' })} />);
  await click('Открыть общий разбор');
  fireEvent.change(screen.getByLabelText('Момент разбора'), { target: { value: '1' } });
  expect(document.body.textContent).toContain('Поступила опись');
  await click('Известно стороне А');
  expect(document.body.textContent).toContain('Поступила опись');
  expect(document.body.textContent).not.toContain('Текст второй стороны');
  await click('Известно стороне Б');
  expect(document.body.textContent).not.toContain('Поступила опись');
  expect(document.body.textContent).not.toContain('Мой текст');
  await click('Позднее');
  expect(document.body.textContent).toContain('Поступила опись');
});
