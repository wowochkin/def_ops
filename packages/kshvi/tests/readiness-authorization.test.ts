import { expect, it } from 'vitest';
import { assertReadyForTask, type ReadinessState } from '../src/forces/readiness';

it('AC-24: богатое состояние принимает только разрешение из собственного журнала', () => {
  const state: ReadinessState = {
    subjectId: 'force-1', subjectKind: 'FORCE', initialLevel: 0.4, requiredLevel: 0.8, status: 'PARTIAL',
    completedActivityIds: [], activityRecords: [], reports: [], criterionResults: {},
    limitations: [{ code: 'SIGNAL_NOT_RECEIVED', since: '2030-01-01T06:00:00.000Z', details: 'Сигнал не доведён' }],
    authorizations: [], history: [],
  };
  const external = { decisionId: 'not-in-journal', actorId: 'chief', authorized: true, basis: 'Внешний объект', rationale: 'Попытка обхода', at: '2030-01-01T07:00:00.000Z' };
  const result = assertReadyForTask({ scenarioState: 'SEALED', readiness: state, allowPartial: true, authorization: external });
  expect(result.allowed).toBe(false);
  expect(result.status).toBe('BLOCKED');
  expect(result.missing).toEqual(['SIGNAL_NOT_RECEIVED']);
});
