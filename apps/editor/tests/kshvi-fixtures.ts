import type { ConductClient, ConductCommands, ConductProjection } from '../src/modern/kshvi/conduct/shared/types';

export function kshviProjection(overrides: Partial<ConductProjection> = {}): ConductProjection {
  const base: ConductProjection = {
    instanceId: 'instance-test', sideId: 'blue', role: 'TRAINEE', status: 'READY',
    officialOperationalAt: '2030-01-01T02:00:00Z', wallClockAt: '2030-01-01T12:00:00+03:00', speed: '2×', connection: 'CONNECTED', lastServerSyncAt: '2030-01-01T02:00:01Z',
    live: { geometry: 'LIVE', document: 'Донесение node-1', calculation: 'calculation-1', state: 'Исполняется' },
    events: [
      { id: 'event-1', title: 'Первое событие', operationalAt: '2030-01-01T01:00:00Z', geometry: 'ONE', document: 'Донесение node-1', calculation: 'calculation-1', state: 'Состояние 1', nodeId: 'node-1', cause: 'supply' },
      { id: 'event-2', title: 'Второе событие', operationalAt: '2030-01-01T01:30:00Z', geometry: 'TWO', document: 'Донесение node-2', calculation: 'calculation-2', state: 'Состояние 2', nodeId: 'node-2', cause: 'communication' },
    ],
    decision: { id: 'decision-test', status: 'DRAFT', intent: 'Проект решения', completedElements: [], goals: '', tasks: '', resources: '', deadlines: '', coordination: '', reserves: '', transitionConditions: '', assumptions: '' },
    order: { id: 'order-1', status: 'EXECUTING', receivedAt: '2030-01-01T01:05:00Z', actualCosts: { timeMinutes: 10, resources: { fuel: 2 } }, position: { remainingMeters: 4000, travelledMeters: 1000 } },
    assignedNodeIds: ['node-1', 'node-2'],
    force: {
      equipment: { fact: 8, staff: 10, serviceable: 7, reserve: 1 }, mps: { moral: 0.7, psychological: null, reported: true, history: ['event-1'] },
      readiness: ['Незавершённые мероприятия: проверка'], formation: ['Первый эшелон: рубеж А'], logistics: { summary: 'Заявки, поставки, ремонт, маршруты и дефицит', deficit: 2, calculationFactor: 'resourceDeficit' },
    },
    massOperation: { objects: [{ id: 'input-1' }, { id: 'input-2' }, { id: 'input-3' }] },
    canReadTruth: true,
    leader: { stage: 'Этап 2', trainingQuestions: 'Управление, МТО', deviations: 'node-2: доклад просрочен', approvalQueue: '2 заявки', stateSummary: '6 инстанций', goalSummary: 'Цель 1: исполняется' },
    playgroup: { queue: '3 вводные', buildup: 'stage-2', tree: 'node-command → node-1', causal: 'order-1 → calculation-1' },
  };
  return { ...base, ...overrides };
}

export function kshviCommands(overrides: Partial<ConductCommands> = {}): ConductCommands {
  return {
    saveDecision: async draft => draft,
    transitionDecision: async input => ({ ...input.draft, status: input.to }),
    cancelOrder: async ({ orderId }) => ({ ...kshviProjection().order!, id: orderId, status: 'CANCELLED_AFTER_RECEIPT' }),
    previewInputs: async ({ objectIds }) => objectIds.map(objectId => ({ objectId, status: objectId === 'input-3' ? 'APPROVAL_REQUIRED' : 'ALLOWED', message: objectId === 'input-3' ? 'Требуется утверждение' : 'Допустимо' })),
    applyInputs: async ({ objectIds }) => objectIds.map(objectId => ({ objectId, status: objectId === 'input-3' ? 'REJECTED' : 'APPLIED', message: objectId === 'input-3' ? 'Вне делегирования' : 'Серверная ревизия 4' })),
    executeCritical: async command => `Серверная ревизия 9: ${command} зафиксирован`,
    saveConclusion: async input => input.evidenceIds,
    loadPerspective: async perspective => kshviProjection({ role: perspective }),
    ...overrides,
  };
}

export function kshviClient(overrides: Partial<ConductClient> = {}): ConductClient {
  return {
    ...kshviCommands(overrides),
    loadProjection: async () => kshviProjection(),
    checkAudience: async () => ({ allowed: true, reason: 'Проверено сервером' }),
    loadAudienceProjection: async () => kshviProjection({ role: 'PROJECTOR', projectorTitle: 'Публичный итог этапа' }),
    ...overrides,
  };
}
