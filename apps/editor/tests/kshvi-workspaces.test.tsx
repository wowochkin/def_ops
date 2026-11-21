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

afterEach(cleanup);

it('не меняет официальные часы при просмотре прошлого', () => {
  render(<TraineeWorkspace />);
  expect(screen.getByText('Официальное время: 2030-01-01T02:00:00Z')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Просмотреть событие' }));
  expect(screen.getByText('Режим просмотра прошлого')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'К текущему времени' })).toBeTruthy();
  expect(screen.getByText('Официальное время: 2030-01-01T02:00:00Z')).toBeTruthy();
  expect(screen.getByText('Документ: Донесение node-1')).toBeTruthy();
  expect(screen.getByText('Расчёт: calculation-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'К текущему времени' }));
  expect(screen.queryByText('Режим просмотра прошлого')).toBeNull();
});

it('рабочее место обучаемого содержит личные документы, сообщения, решение и приказ без служебного плана', () => {
  const { container } = render(<TraineeWorkspace />);
  for (const name of ['Личная карта', 'Документы и вводные', 'Входящие и исходящие сообщения', 'Решение обучаемого', 'Исполнение приказа order-1']) expect(screen.getByRole('heading', { name })).toBeTruthy();
  expect(container.textContent).not.toContain('Скрытый замысел красных');
  expect(container.textContent).not.toContain('Служебный план наращивания');
});

it('критическая команда руководителя требует подтверждения с последствиями и показывает фактический результат', () => {
  const onExecute = vi.fn().mockReturnValue('Серверная ревизия 9: общий отбой зафиксирован');
  render(<LeaderWorkspace onExecute={onExecute} />);
  expect(screen.getByText('Этап: Этап 2 · скорость 2×')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Общий отбой' }));
  expect(screen.getByText(/Последствия: остановка всех инстанций/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить: Общий отбой' }));
  expect(onExecute).toHaveBeenCalledWith('GENERAL_STOP');
  expect(screen.getByText('Фактический результат: Серверная ревизия 9: общий отбой зафиксирован')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /Победитель/ })).toBeNull();
});

it('группа видит причинные связи и пообъектный результат частичного массового применения', () => {
  render(<PlaygroupWorkspace />);
  expect(screen.getByRole('heading', { name: 'Причинные связи' })).toBeTruthy();
  expect(screen.getByText('Текущий мир')).toBeTruthy();
  expect(screen.getByText('Предлагаемое изменение')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Единое обоснование'), { target: { value: 'Плановая вводная G2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Предварительная проверка' }));
  expect(screen.getByText('Проверено: 2 допустимо, 1 требует отдельного утверждения')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное' }));
  expect(screen.getByText('Результат: 2 успешно, 1 отклонено')).toBeTruthy();
  expect(screen.getByText('input-3: не применено — вне делегирования')).toBeTruthy();
});

it('посредник ограничен закреплёнными инстанциями и заранее видит основание полномочия', () => {
  const { container } = render(<IntermediaryWorkspace assignedNodeIds={['node-1', 'node-2']} />);
  expect(screen.getByText('Закреплённые инстанции: node-1, node-2')).toBeTruthy();
  expect(screen.getByText('в пределах делегирования')).toBeTruthy();
  expect(screen.getByText('требуется утверждение')).toBeTruthy();
  expect(container.textContent).not.toContain('node-secret');
  for (const name of ['Очередь на розыгрыш', 'Таймеры докладов', 'Лист наблюдения', 'Частный разбор']) expect(screen.getByRole('heading', { name })).toBeTruthy();
});

it('аналитик связывает выводы с доказательствами и фильтрует перспективы', () => {
  render(<AnalystWorkspace canReadTruth />);
  fireEvent.change(screen.getByLabelText('Фильтр по причине'), { target: { value: 'supply' } });
  expect(screen.getByText('Показаны события с причиной: supply')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Истинное состояние' }));
  expect(screen.getByText('Перспектива: истинное состояние')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Вывод аналитика'), { target: { value: 'Дефицит повлиял на срок' } });
  fireEvent.click(screen.getByRole('button', { name: 'Связать с доказательством evidence-1' }));
  expect(screen.getByText('Сохранён проект вывода с 1 доказательством')).toBeTruthy();
});

it('передача рабочего места очищает видимый черновик и не восстанавливается по Back', () => {
  const onHandover = vi.fn();
  render(<TraineeWorkspace onHandover={onHandover} />);
  fireEvent.change(screen.getByLabelText('Замысел'), { target: { value: 'Приватный черновик обучаемого' } });
  fireEvent.click(screen.getByRole('button', { name: 'Передать рабочее место' }));
  expect(screen.getByRole('heading', { name: 'Рабочее место передано' })).toBeTruthy();
  expect(screen.queryByDisplayValue('Приватный черновик обучаемого')).toBeNull();
  fireEvent.popState(window);
  expect(screen.getByRole('heading', { name: 'Рабочее место передано' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить новую роль' }));
  expect(onHandover).toHaveBeenCalled();
});

it('каждый экран различает семь состояний и даёт понятное действие', () => {
  const cases = [
    ['LOADING', 'Загрузка данных', 'Повторить'],
    ['EMPTY', 'Пусто: события ещё не созданы', 'Повторить'],
    ['FORBIDDEN', 'Нет прав', 'Обратиться к администратору'],
    ['NO_DATA', 'Нет данных', 'Повторить'],
    ['STALE', 'Данные устарели', 'Повторить'],
    ['PARTIAL_FAILURE', 'Частичный сбой', 'Перейти к журналу'],
    ['UNAVAILABLE', 'Сервис недоступен', 'Восстановить соединение'],
  ] as const;
  const { rerender } = render(<WorkspaceState status="LOADING" />);
  for (const [status, text, action] of cases) {
    rerender(<WorkspaceState status={status} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByRole('button', { name: action })).toBeTruthy();
  }
  render(<TraineeWorkspace />);
  expect(screen.getAllByText(/Соединение: подключено/).length).toBeGreaterThan(0);
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
  render(<ForceStateTabs />);
  const tabs = ['Оснащённость', 'МПС', 'Готовность', 'Построение', 'МТО'];
  for (const name of tabs) expect(screen.getByRole('tab', { name })).toBeTruthy();
  expect(screen.getByText('Факт/штат: 8/10')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'МПС' }));
  expect(screen.getByText('Компоненты МПС и история')).toBeTruthy();
  expect(screen.getByText('Донесено')).toBeTruthy();
  expect(screen.getByText('Неизвестно')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Готовность', selected: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'МТО' }));
  expect(screen.getByText('Заявки, поставки, ремонт, маршруты и дефицит')).toBeTruthy();
  expect(screen.getByText('Фактор расчёта: resourceDeficit')).toBeTruthy();
});

it('технический администратор не видит содержание, а временное раскрытие требует причину и аудит', () => {
  const onAudit = vi.fn();
  const { container } = render(<TechnicalAdminWorkspace onAudit={onAudit} />);
  for (const name of ['Учётные записи и назначения', 'Состояние узлов и очереди', 'Резервные копии', 'Журнал доступа']) expect(screen.getByRole('heading', { name })).toBeTruthy();
  expect(container.textContent).not.toContain('Замысел синих');
  fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать временное раскрытие' }));
  expect(screen.getByRole('alert').textContent).toContain('причину');
  fireEvent.change(screen.getByLabelText('Причина временного раскрытия'), { target: { value: 'Восстановление узла' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зарегистрировать временное раскрытие' }));
  expect(onAudit).toHaveBeenCalledWith({ reason: 'Восстановление узла', scope: 'RECOVERY', contentGranted: false });
  expect(screen.getByText('Аудит: причина записана, содержание не раскрыто')).toBeTruthy();
});


it('массовая операция учитывает фактически выбранные объекты', () => {
  render(<PlaygroupWorkspace />);
  fireEvent.click(screen.getByLabelText('input-2'));
  fireEvent.change(screen.getByLabelText('Единое обоснование'), { target: { value: 'Выборочная вводная' } });
  fireEvent.click(screen.getByRole('button', { name: 'Предварительная проверка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное' }));
  expect(screen.getByText('Результат: 1 успешно, 1 отклонено, 1 не выбрано')).toBeTruthy();
  expect(screen.getByText('input-2: не выбрано')).toBeTruthy();
});

it('посредник не получает таймеры и сведения незакреплённой инстанции', () => {
  const { container } = render(<IntermediaryWorkspace assignedNodeIds={['node-1']} />);
  expect(screen.getByText('node-1: осталось 5 минут')).toBeTruthy();
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
  render(<TraineeWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Передать рабочее место' }));
  await waitFor(() => {
    expect(localStorage.getItem('kshvi.draft')).toBeNull();
    expect(localStorage.getItem('kshvi.projection')).toBeNull();
    expect(localStorage.getItem('kshvi.projector')).toBeNull();
  });
  expect(localStorage.getItem('def_ops.modern.weather.region')).toBe('unchanged');
});
