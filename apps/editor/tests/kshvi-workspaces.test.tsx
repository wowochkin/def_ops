// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TraineeWorkspace } from '../src/modern/kshvi/conduct/TraineeWorkspace';
import { LeaderWorkspace } from '../src/modern/kshvi/conduct/LeaderWorkspace';
import { PlaygroupWorkspace } from '../src/modern/kshvi/conduct/PlaygroupWorkspace';
import { IntermediaryWorkspace } from '../src/modern/kshvi/conduct/IntermediaryWorkspace';
import { AnalystWorkspace } from '../src/modern/kshvi/conduct/AnalystWorkspace';
import { TechnicalAdminWorkspace } from '../src/modern/kshvi/conduct/TechnicalAdminWorkspace';
import { ForceStateTabs } from '../src/modern/kshvi/conduct/ForceStateTabs';
import { NotificationCenter, WorkspaceState } from '../src/modern/kshvi/conduct/shared/browser';
import { kshviCommands, kshviProjection } from './kshvi-fixtures';

afterEach(cleanup);

it('не меняет официальные часы при просмотре прошлого', () => {
  render(<TraineeWorkspace projection={kshviProjection()} commands={kshviCommands()} />);
  expect(screen.getByText('Официальное время: 2030-01-01T02:00:00Z')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Просмотреть событие event-1' }));
  expect(screen.getByText('Режим просмотра прошлого')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'К текущему времени' })).toBeTruthy();
  expect(screen.getByText('Официальное время: 2030-01-01T02:00:00Z')).toBeTruthy();
  expect(screen.getByText('Документ: Донесение node-1')).toBeTruthy();
  expect(screen.getByText('Расчёт: calculation-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'К текущему времени' }));
  expect(screen.queryByText('Режим просмотра прошлого')).toBeNull();
});

it('рабочее место обучаемого содержит личные документы, сообщения, решение и приказ без служебного плана', () => {
  const { container } = render(<TraineeWorkspace projection={kshviProjection()} commands={kshviCommands()} />);
  for (const name of ['Личная карта', 'Документы и вводные', 'Входящие и исходящие сообщения', 'Решение обучаемого', 'Исполнение приказа order-1']) expect(screen.getByRole('heading', { name })).toBeTruthy();
  expect(container.textContent).not.toContain('Скрытый замысел красных');
  expect(container.textContent).not.toContain('Служебный план наращивания');
});

it('критическая команда руководителя требует подтверждения и показывает ответ сервера', async () => {
  const executeCritical = vi.fn().mockResolvedValue('Серверная ревизия 9: общий отбой зафиксирован');
  render(<LeaderWorkspace projection={kshviProjection()} commands={kshviCommands({ executeCritical })} />);
  expect(screen.getByText('Этап: Этап 2 · скорость 2×')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Общий отбой' }));
  expect(screen.getByText(/Последствия: остановка всех инстанций/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить: Общий отбой' }));
  expect(executeCritical).toHaveBeenCalledWith('GENERAL_STOP');
  await waitFor(() => expect(screen.getByText('Фактический результат: Серверная ревизия 9: общий отбой зафиксирован')).toBeTruthy());
  expect(screen.queryByRole('heading', { name: /Победитель/ })).toBeNull();
});

it('не подставляет фиктивный этап без серверной проекции', () => {
  render(<LeaderWorkspace />);
  expect(screen.getByText('Этап: Нет данных')).toBeTruthy();
});

it('группа получает пообъектные результаты preview и apply из команд', async () => {
  render(<PlaygroupWorkspace projection={kshviProjection()} commands={kshviCommands()} />);
  expect(screen.getByRole('heading', { name: 'Причинные связи' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Единое обоснование'), { target: { value: 'Плановая вводная G2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Предварительная проверка' }));
  await waitFor(() => expect(screen.getByText('input-1: Допустимо')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное' }));
  await waitFor(() => expect(screen.getByText('input-1: Серверная ревизия 4')).toBeTruthy());
  expect(screen.getByText('input-3: Вне делегирования')).toBeTruthy();
});

it('посредник ограничен закреплёнными инстанциями и видит основания полномочий', () => {
  const { container } = render(<IntermediaryWorkspace projection={kshviProjection()} />);
  expect(screen.getByText('Закреплённые инстанции: node-1, node-2')).toBeTruthy();
  expect(screen.getByText('в пределах делегирования')).toBeTruthy();
  expect(screen.getByText('требуется утверждение')).toBeTruthy();
  expect(container.textContent).not.toContain('node-secret');
  for (const name of ['Очередь на розыгрыш', 'Таймеры докладов', 'Лист наблюдения', 'Частный разбор']) expect(screen.getByRole('heading', { name })).toBeTruthy();
});

it('аналитик загружает перспективы и сохраняет вывод через команды', async () => {
  const loadPerspective = vi.fn().mockImplementation(async perspective => kshviProjection({ role: perspective }));
  const saveConclusion = vi.fn().mockResolvedValue(['evidence-1']);
  render(<AnalystWorkspace projection={kshviProjection()} commands={kshviCommands({ loadPerspective, saveConclusion })} />);
  fireEvent.change(screen.getByLabelText('Фильтр по причине'), { target: { value: 'supply' } });
  expect(screen.getByText('Показаны события с причиной: supply')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Истинное состояние' }));
  await waitFor(() => expect(screen.getByText('Перспектива: истинное состояние')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Вывод аналитика'), { target: { value: 'Дефицит повлиял на срок' } });
  fireEvent.click(screen.getByRole('button', { name: 'Связать с доказательством evidence-1' }));
  await waitFor(() => expect(screen.getByText('Сервер подтвердил проект вывода с 1 доказательством')).toBeTruthy());
});

it('передача рабочего места скрывает черновик и не восстанавливается по Back', async () => {
  const onHandover = vi.fn();
  render(<TraineeWorkspace projection={kshviProjection()} commands={kshviCommands()} onHandover={onHandover} />);
  fireEvent.change(screen.getByLabelText('Замысел'), { target: { value: 'Приватный черновик обучаемого' } });
  fireEvent.click(screen.getByRole('button', { name: 'Передать рабочее место' }));
  expect(screen.getByRole('heading', { name: 'Рабочее место передано' })).toBeTruthy();
  expect(screen.queryByDisplayValue('Приватный черновик обучаемого')).toBeNull();
  fireEvent.popState(window);
  expect(screen.getByRole('heading', { name: 'Рабочее место передано' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Подтвердить новую роль' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить новую роль' }));
  expect(onHandover).toHaveBeenCalled();
});

it('каждый экран различает семь состояний и даёт понятное действие', () => {
  const cases = [
    ['LOADING', 'Загрузка данных', 'Повторить'], ['EMPTY', 'Пусто: события ещё не созданы', 'Повторить'], ['FORBIDDEN', 'Нет прав', 'Обратиться к администратору'],
    ['NO_DATA', 'Нет данных', 'Повторить'], ['STALE', 'Данные устарели', 'Повторить'], ['PARTIAL_FAILURE', 'Частичный сбой', 'Перейти к журналу'], ['UNAVAILABLE', 'Сервис недоступен', 'Восстановить соединение'],
  ] as const;
  const { rerender } = render(<WorkspaceState status="LOADING" />);
  for (const [status, text, action] of cases) {
    rerender(<WorkspaceState status={status} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByRole('button', { name: action })).toBeTruthy();
  }
  render(<TraineeWorkspace projection={kshviProjection()} commands={kshviCommands()} />);
  expect(screen.getAllByText(/Соединение: CONNECTED/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Синхронизировано:/).length).toBeGreaterThan(0);
});

it('группирует повторы и не позволяет скрыть критическое уведомление без подтверждения', () => {
  render(<NotificationCenter notifications={[
    { id: 'n1', groupId: 'g1', priority: 'CRITICAL', recipient: 'leader', dueAt: '2030-01-01T03:00:00Z', text: 'Просрочен доклад', acknowledged: false },
    { id: 'n2', groupId: 'g1', priority: 'CRITICAL', recipient: 'leader', dueAt: '2030-01-01T03:01:00Z', text: 'Просрочен доклад', acknowledged: false },
  ]} />);
  expect(screen.getByText('2 события')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Скрыть' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить критическое' }));
  expect(screen.getByText('Подтверждено')).toBeTruthy();
});

it('вкладки состояния силы различают факт, штат, донесено и неизвестное и работают с клавиатуры', () => {
  render(<ForceStateTabs force={kshviProjection().force} />);
  for (const name of ['Оснащённость', 'МПС', 'Готовность', 'Построение', 'МТО']) expect(screen.getByRole('tab', { name })).toBeTruthy();
  expect(screen.getByText('Факт/штат: 8/10')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'МПС' }));
  expect(screen.getByText('Компоненты МПС и история')).toBeTruthy();
  expect(screen.getByText('Донесено')).toBeTruthy();
  expect(screen.getByText('Неизвестно')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Готовность', selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'МТО' }));
  expect(screen.getAllByText('Заявки, поставки, ремонт, маршруты и дефицит').length).toBeGreaterThan(0);
  expect(screen.getByText('Фактор расчёта: resourceDeficit')).toBeTruthy();
});

it('технический администратор регистрирует временный доступ только через callback', async () => {
  const onTemporaryAccess = vi.fn().mockResolvedValue(undefined);
  const { container } = render(<TechnicalAdminWorkspace projection={kshviProjection()} onTemporaryAccess={onTemporaryAccess} />);
  for (const name of ['Учётные записи и назначения', 'Состояние узлов и очереди', 'Резервные копии', 'Журнал доступа']) expect(screen.getByRole('heading', { name })).toBeTruthy();
  expect(container.textContent).not.toContain('Замысел синих');
  fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать временное раскрытие' }));
  expect(screen.getByRole('alert').textContent).toContain('причину');
  fireEvent.change(screen.getByLabelText('Причина временного раскрытия'), { target: { value: 'Восстановление узла' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать временное раскрытие' }));
  await waitFor(() => expect(onTemporaryAccess).toHaveBeenCalledWith({ reason: 'Восстановление узла', scope: 'RECOVERY' }));
  expect(screen.getByText('Аудит: причина записана, содержание не раскрыто')).toBeTruthy();
});

it('посредник не получает сведения незакреплённой инстанции', () => {
  const { container } = render(<IntermediaryWorkspace projection={kshviProjection({ assignedNodeIds: ['node-1'] })} />);
  expect(screen.getByText('Закреплённые инстанции: node-1')).toBeTruthy();
  expect(container.textContent).not.toContain('node-2');
});

it('звук и всплывающие окна настраиваются без скрытия критического текста', () => {
  render(<NotificationCenter notifications={[{ id: 'n1', groupId: 'g1', priority: 'CRITICAL', recipient: 'leader', dueAt: '2030-01-01T03:00:00Z', text: 'Критический доклад', acknowledged: false }]} />);
  const sound = screen.getByLabelText('Звуковые уведомления');
  const popups = screen.getByLabelText('Всплывающие уведомления');
  expect(sound).toHaveProperty('checked', true);
  expect(popups).toHaveProperty('checked', true);
  fireEvent.click(sound);
  fireEvent.click(popups);
  expect(sound).toHaveProperty('checked', false);
  expect(popups).toHaveProperty('checked', false);
  expect(screen.getByText('Критический доклад')).toBeTruthy();
});

it('передача устройства удаляет приватные ключи КШВИ, но не настройки соседних разделов', async () => {
  localStorage.setItem('kshvi.draft', 'secret-draft');
  localStorage.setItem('kshvi.projection', 'secret-projection');
  localStorage.setItem('kshvi.projector', 'privileged');
  localStorage.setItem('def_ops.modern.weather.region', 'unchanged');
  render(<TraineeWorkspace projection={kshviProjection()} commands={kshviCommands()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Передать рабочее место' }));
  await waitFor(() => {
    expect(localStorage.getItem('kshvi.draft')).toBeNull();
    expect(localStorage.getItem('kshvi.projection')).toBeNull();
    expect(localStorage.getItem('kshvi.projector')).toBeNull();
  });
  expect(localStorage.getItem('def_ops.modern.weather.region')).toBe('unchanged');
});
