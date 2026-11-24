import type { ConductProjection } from './types';

/** Явно неофициальный обзор без активного сеанса; не заменяет серверный мир. */
export const overviewProjection: ConductProjection = {
  instanceId: 'overview', sideId: 'UNKNOWN', role: 'OVERVIEW', status: 'NO_DATA',
  officialOperationalAt: 'Нет активного сеанса', wallClockAt: 'Нет активного сеанса', speed: '—', connection: 'DISCONNECTED', lastServerSyncAt: 'Нет активного сеанса',
  live: { geometry: 'Нет активного сеанса', document: 'Нет активного сеанса', calculation: 'Нет активного сеанса', state: 'Нет активного сеанса' },
  events: [],
  decision: { id: 'overview-decision', status: 'DRAFT', intent: 'Проект решения', completedElements: [], goals: '', tasks: '', resources: '', deadlines: '', coordination: '', reserves: '', transitionConditions: '', assumptions: '' },
  order: null, assignedNodeIds: [],
  force: {
    equipment: { fact: 0, staff: 0, serviceable: null, reserve: null }, mps: { moral: null, psychological: null, reported: false, history: [] },
    readiness: [], formation: [], logistics: { summary: 'Нет активного сеанса', deficit: null, calculationFactor: 'UNKNOWN' },
  },
  massOperation: { objects: [] }, canReadTruth: false,
};
