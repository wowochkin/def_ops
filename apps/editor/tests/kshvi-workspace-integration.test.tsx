// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TraineeWorkspace } from '../src/modern/kshvi/conduct/TraineeWorkspace';
import { PlaygroupWorkspace } from '../src/modern/kshvi/conduct/PlaygroupWorkspace';
import { ProjectorWorkspace } from '../src/modern/kshvi/conduct/ProjectorWorkspace';
import { DecisionEditor } from '../src/modern/kshvi/conduct/DecisionEditor';
import { LinkedPanels } from '../src/modern/kshvi/conduct/shared/LinkedPanels';
import type { ConductProjection } from '../src/modern/kshvi/conduct/shared/types';
import type { OrderPanelModel } from '../src/modern/kshvi/conduct/OrdersPanel';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function projection(): ConductProjection {
  return {
    instanceId: 'instance-real', sideId: 'blue', role: 'TRAINEE', status: 'READY',
    officialOperationalAt: '2030-01-01T02:00:00Z', wallClockAt: '2030-01-01T12:00:00+03:00', speed: '2×', connection: 'CONNECTED', lastServerSyncAt: '2030-01-01T02:00:01Z',
    live: { geometry: 'LIVE', document: 'current-document', calculation: 'current-calculation', state: 'current-state' },
    events: [
      { id: 'event-1', title: 'Первое', operationalAt: '2030-01-01T01:00:00Z', geometry: 'ONE', document: 'doc-1', calculation: 'calc-1', state: 'state-1' },
      { id: 'event-2', title: 'Второе', operationalAt: '2030-01-01T01:30:00Z', geometry: 'TWO', document: 'doc-2', calculation: 'calc-2', state: 'state-2' },
    ],
    decision: { id: 'decision-real', status: 'DRAFT', intent: 'Проект из проекции', completedElements: [], goals: '', tasks: '', resources: '', deadlines: '', coordination: '', reserves: '', transitionConditions: '', assumptions: '' },
    order: { id: 'order-real', status: 'EXECUTING', receivedAt: '2030-01-01T01:05:00Z', actualCosts: { timeMinutes: 10, resources: { fuel: 2 } }, position: { remainingMeters: 4000, travelledMeters: 1000 } },
    assignedNodeIds: ['node-1'],
    force: {
      equipment: { fact: 8, staff: 10, serviceable: 7, reserve: 1 }, mps: { moral: 0.7, psychological: null, reported: true, history: ['event-1'] },
      readiness: ['check'], formation: ['echelon'], logistics: { summary: 'server-logistics', deficit: 2, calculationFactor: 'resourceDeficit' },
    },
    massOperation: { objects: [{ id: 'input-1' }, { id: 'input-2' }, { id: 'input-3' }] },
    canReadTruth: false,
  };
}

it('Critical 3: обучаемый отображает реальную проекцию и ждёт серверную отмену приказа', async () => {
  const pending = deferred<OrderPanelModel>();
  const cancelOrder = vi.fn().mockReturnValue(pending.promise);
  render(<TraineeWorkspace projection={projection()} commands={{ cancelOrder, saveDecision: vi.fn(), transitionDecision: vi.fn() }} />);
  expect(screen.getByText('LIVE')).toBeTruthy();
  expect(screen.queryByText('37.62000, 55.70000')).toBeNull();
  fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Серверная вводная' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить приказ' }));
  expect(cancelOrder).toHaveBeenCalledWith({ orderId: 'order-real', reason: 'Серверная вводная' });
  expect(screen.queryByText(/CANCELLED_AFTER_RECEIPT/)).toBeNull();
  await act(async () => { pending.resolve({ ...projection().order!, status: 'CANCELLED_AFTER_RECEIPT' }); await pending.promise; });
  await waitFor(() => expect(screen.getByText(/CANCELLED_AFTER_RECEIPT/)).toBeTruthy());
  expect(screen.getByText('10 мин')).toBeTruthy();
});

it('Important 1: DecisionEditor передаёт все поля и запрашивает только разрешённый доменный переход', async () => {
  const saveDecision = vi.fn();
  const transitionDecision = vi.fn();
  render(<DecisionEditor decision={projection().decision} commands={{ saveDecision, transitionDecision }} />);
  const values = {
    'Замысел': 'intent-new', 'Ранжированные цели': 'goals-new', 'Задачи': 'tasks-new', 'Распределение ресурсов': 'resources-new', 'Сроки': 'deadlines-new',
    'Взаимодействие': 'coordination-new', 'Резервы': 'reserves-new', 'Условия перехода': 'conditions-new', 'Допущения': 'assumptions-new',
  };
  for (const [label, value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить проект решения' }));
  expect(saveDecision).toHaveBeenCalledWith(expect.objectContaining({
    intent: 'intent-new', goals: 'goals-new', tasks: 'tasks-new', resources: 'resources-new', deadlines: 'deadlines-new', coordination: 'coordination-new', reserves: 'reserves-new', transitionConditions: 'conditions-new', assumptions: 'assumptions-new',
  }));
  expect(screen.queryByRole('button', { name: 'Завершить решение' })).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Принять решение' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Принять решение' }));
  expect(transitionDecision).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'decision-real', from: 'DRAFT', to: 'ACCEPTED' }));
});

it('Critical 3: группа показывает только результаты preview/apply callbacks, без локального «применено»', async () => {
  const previewInputs = vi.fn().mockResolvedValue([{ objectId: 'input-1', status: 'ALLOWED', message: 'Допустимо' }, { objectId: 'input-3', status: 'APPROVAL_REQUIRED', message: 'Нужно утверждение' }]);
  const pending = deferred<{ objectId: string; status: string; message: string }[]>();
  const applyInputs = vi.fn().mockReturnValue(pending.promise);
  render(<PlaygroupWorkspace projection={projection()} commands={{ previewInputs, applyInputs }} />);
  fireEvent.click(screen.getByLabelText('input-2'));
  fireEvent.change(screen.getByLabelText('Единое обоснование'), { target: { value: 'Основание G2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Предварительная проверка' }));
  await waitFor(() => expect(screen.getByText('input-1: Допустимо')).toBeTruthy());
  expect(previewInputs).toHaveBeenCalledWith({ objectIds: ['input-1', 'input-3'], reason: 'Основание G2' });
  fireEvent.click(screen.getByRole('button', { name: 'Применить выбранное' }));
  expect(screen.queryByText(/применено/)).toBeNull();
  await act(async () => { pending.resolve([{ objectId: 'input-1', status: 'APPLIED', message: 'Серверная ревизия 4' }, { objectId: 'input-3', status: 'REJECTED', message: 'Вне делегирования' }]); await pending.promise; });
  await waitFor(() => expect(screen.getByText('input-1: Серверная ревизия 4')).toBeTruthy());
  expect(screen.getByText('input-3: Вне делегирования')).toBeTruthy();
});

it('Critical 3: проектор получает аудиторную проекцию через callback и не показывает её заранее', async () => {
  const pending = deferred<ConductProjection>();
  const loadAudienceProjection = vi.fn().mockReturnValue(pending.promise);
  const checkAudience = vi.fn().mockResolvedValue({ allowed: true, reason: 'Проверено сервером' });
  render(<ProjectorWorkspace commands={{ checkAudience, loadAudienceProjection }} />);
  fireEvent.change(screen.getByLabelText('Профиль аудитории'), { target: { value: 'PUBLIC_FINAL' } });
  fireEvent.click(screen.getByRole('button', { name: 'Вывести на проектор' }));
  await waitFor(() => expect(loadAudienceProjection).toHaveBeenCalledWith('PUBLIC_FINAL'));
  expect(screen.queryByText('Серверный публичный итог')).toBeNull();
  await act(async () => { pending.resolve({ ...projection(), role: 'PROJECTOR', projectorTitle: 'Серверный публичный итог' }); await pending.promise; });
  await waitFor(() => expect(screen.getByText('Серверный публичный итог')).toBeTruthy());
  expect(screen.getByText(/Проверено сервером/)).toBeTruthy();
});

it('Minor 1: связанная навигация выбирает любое событие и возвращает live-проекцию', () => {
  render(<LinkedPanels events={projection().events} live={projection().live} mapTitle="Карта" />);
  expect(screen.getByText('LIVE')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Просмотреть событие event-2' }));
  expect(screen.getByText('TWO')).toBeTruthy();
  expect(screen.getByText('Документ: doc-2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'К текущему времени' }));
  expect(screen.getByText('LIVE')).toBeTruthy();
  expect(screen.queryByText('TWO')).toBeNull();
});

it('Important 6: новая роль заблокирована до завершения Cache API и IndexedDB очистки', async () => {
  localStorage.setItem('kshvi.draft', 'secret');
  const cacheDelete = deferred<boolean>();
  const databaseDelete = deferred<void>();
  vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['kshvi-projections']), delete: vi.fn().mockReturnValue(cacheDelete.promise) });
  vi.stubGlobal('indexedDB', { deleteDatabase: vi.fn().mockImplementation(() => {
    const request: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
    databaseDelete.promise.then(() => request.onsuccess?.());
    return request as unknown as IDBOpenDBRequest;
  }) });
  const onHandover = vi.fn();
  render(<TraineeWorkspace projection={projection()} commands={{ cancelOrder: vi.fn(), saveDecision: vi.fn(), transitionDecision: vi.fn() }} onHandover={onHandover} />);
  fireEvent.click(screen.getByRole('button', { name: 'Передать рабочее место' }));
  const confirm = screen.getByRole('button', { name: 'Подтвердить новую роль' });
  expect(confirm).toHaveProperty('disabled', true);
  expect(onHandover).not.toHaveBeenCalled();
  await act(async () => { cacheDelete.resolve(true); databaseDelete.resolve(); await Promise.resolve(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Подтвердить новую роль' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить новую роль' }));
  expect(onHandover).toHaveBeenCalled();
  expect(localStorage.getItem('kshvi.draft')).toBeNull();
  vi.unstubAllGlobals();
});
