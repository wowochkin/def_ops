import { createElectronicIntermediaryAssignment, type ElectronicIntermediaryAssignmentInput } from '../src/model/assignment';
import type { ServerIntermediaryProjection } from '../src/intermediary/classify';

export const routineActionKinds = [
  'classifyInput',
  'updateWorkingMap',
  'recordAssessment',
  'makeDecision',
  'assignTask',
  'createDocument',
  'coordinateDocument',
  'issueDocument',
  'sendInput',
  'sendReport',
  'requestCalculation',
  'executeOrder',
  'checkDeadline',
  'requestData',
  'reportToLeader',
  'recordObservation',
] as const;

export function assignmentFixture(overrides: Partial<ElectronicIntermediaryAssignmentInput> = {}) {
  return createElectronicIntermediaryAssignment({
    assignmentId: 'agent-1',
    exerciseId: 'exercise-1',
    bindings: [
      { instanceId: 'higher', sectorIds: ['north'] },
      { instanceId: 'neighbour', sectorIds: ['north'] },
      { instanceId: 'support', sectorIds: ['north'] },
    ],
    roles: ['INTERMEDIARY'],
    projection: { projectionId: 'projection-agent-1', sideIds: ['blue'], sectorIds: ['north'] },
    allowedActions: [...routineActionKinds],
    modernProfile: {
      profileId: 'modern-intermediary',
      version: '1.0.0',
      era: 'modern',
      source: { kind: 'ASSUMPTION', reference: 'Учебный профиль КШВИ' },
      maxOptions: 3,
      riskLimit: 0.5,
      severityLimit: 3,
    },
    schedule: { everyMs: 1_000, timeBudgetMs: 250 },
    escalation: { recipients: ['leader-1'], requiredData: ['activeOrder'] },
    ...overrides,
  });
}

export function projectionFixture(overrides: Partial<ServerIntermediaryProjection> = {}): ServerIntermediaryProjection {
  return {
    assignmentId: 'agent-1',
    exerciseId: 'exercise-1',
    projectionId: 'projection-agent-1',
    revision: 7,
    sequence: 42,
    operationalAt: '2030-01-01T00:10:00.000Z',
    activeOrder: {
      orderId: 'order-1',
      version: 3,
      intent: 'Удержать назначенный район',
      goals: ['Контроль района', 'Своевременный доклад'],
      tasks: ['Наблюдение', 'Доклад'],
      resources: { transport: 2 },
      deadlines: ['2030-01-01T00:20:00.000Z'],
      coordination: ['neighbour'],
      reserves: ['support'],
      transitionConditions: ['Новое наблюдение'],
      assumptions: ['Связь доступна'],
      status: 'EXECUTING',
    },
    tasks: [{ taskId: 'task-1', instanceId: 'higher', status: 'EXECUTING', dueAt: '2030-01-01T00:20:00.000Z' }],
    observations: [{
      observationId: 'observation-1',
      source: 'post-1',
      observedAt: '2030-01-01T00:09:00.000Z',
      deliveredAt: '2030-01-01T00:09:30.000Z',
      summary: 'Изменение активности',
      confidence: 0.6,
      stale: false,
    }],
    reports: [{ reportId: 'report-1', instanceId: 'higher', status: 'RECEIVED', receivedAt: '2030-01-01T00:09:40.000Z' }],
    resources: { transport: 2, calculation: 1 },
    requestedActions: routineActionKinds.map((kind, index) => ({
      actionId: `action-${index + 1}`,
      kind,
      instanceId: 'higher',
      sectorId: 'north',
      payload: { reference: `ref-${index + 1}` },
      risk: 0.1,
      severity: 1,
    })),
    ...overrides,
  };
}

export const wakeFixture = { wakeId: 'wake-1', kind: 'EVENT' as const, requestedAt: '2030-01-01T00:10:00.000Z' };
