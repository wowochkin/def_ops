import { expect, it } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { emptyPreparationDraft, type PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { JsonValue } from '@def-ops/kshvi';
import type { ReadinessStage } from '../../../packages/kshvi/src/forces/readiness-stage';
import { buildRouter } from '../src/app';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { InMemoryExerciseStore } from '../src/store/exercise-store';
import { createScenarioForce } from '../../../apps/editor/src/modern/kshvi/preparation/force-operations';

const at = '2026-11-25T06:00:00Z';
function latest(card: { revision: number; revisions: readonly { revision: number; payload: any }[] }) {
  return card.revisions.find(item => item.revision === card.revision)!.payload.preparation;
}
const stage: ReadinessStage = {
  id: 'stage-1', title: 'Выдвижение в исходный район', startsAt: '2026-11-25T05:00:00Z', dueAt: '2026-11-25T08:00:00Z',
  signal: { id: 'signal-1', sentAt: '2026-11-25T05:00:00Z', senderNodeId: 'hq-command' },
  activities: [{ id: 'deploy', kind: 'DEPLOYMENT', title: 'Занять район', responsibleNodeId: 'hq-blue',
    startAt: '2026-11-25T05:00:00Z', dueAt: '2026-11-25T07:00:00Z', durationMinutes: 30,
    dependsOn: [], requiresSignal: true, preconditions: [], resources: [], reportRequired: true,
    criterion: { id: 'c1', description: 'Район занят и подтверждён докладом' } }],
  completionCriterionIds: ['c1'], adverseOutcomes: ['PARTIAL', 'FAILED'],
};

function draft(): PreparationDraft {
  return {
    ...emptyPreparationDraft(at), forces: [{ ...createScenarioForce(at, 'force-1'), identity: { ...createScenarioForce(at, 'force-1').identity, nodeId: 'hq-blue', sideId: 'blue' } }],
    readinessStage: stage,
    readinessStates: [{ subjectId: 'force-1', subjectKind: 'FORCE', initialLevel: 0.5, requiredLevel: 1, status: 'NOT_STARTED',
      completedActivityIds: [], activityRecords: [], reports: [], criterionResults: {}, limitations: [], authorizations: [], history: [] }],
  };
}

async function setup() {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({ userId: 'editor', organizationId: 'org', username: 'editor', password: 'test-password',
    roles: [{ id: 'editor-role', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'TRUTH_READ'] }] });
  const store = new InMemoryExerciseStore();
  const created = await store.create({ userId: 'editor', organizationId: 'org' }, { title: 'Готовность', purpose: 'research', scale: 'operational' });
  await store.savePreparation({ userId: 'editor', organizationId: 'org' }, created.id, { expectedRevision: 1, draft: draft() as unknown as JsonValue }, 'FULL');
  const service = createService({ name: 'readiness-test', version: '0', port: 0, router: buildRouter({ sessions, exerciseStore: store }) });
  const port = await service.listen();
  const login = await sessions.login('editor', 'test-password');
  await sessions.selectRole(login.token, 'editor-role');
  return { service, port, login, created, store };
}

it('не завершает мероприятие без фактического подтверждения сигнала', async () => {
  const { service, port, login, created } = await setup();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/kshvi/exercises/${created.id}/readiness/advance`, {
      method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'x-csrf-token': login.csrfToken, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 2, at, completions: [{ activityId: 'deploy', report: { id: 'r1', authorId: 'hq-blue', submittedAt: at, text: 'Занял' } }], criteria: { c1: true } }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const card = await response.json();
    const state = latest(card).readinessStates[0];
    expect(state.status).not.toBe('READY');
    expect(state.limitations.map((item: { code: string }) => item.code)).toContain('SIGNAL_NOT_RECEIVED');
  } finally { await service.close(); }
});

it('применяет полный доклад через advanceReadiness и не дублирует его при повторе', async () => {
  const { service, port, login, created, store } = await setup();
  try {
    const input = { expectedRevision: 2, at,
      signalReport: { id: 'signal-report', authorId: 'hq-blue', submittedAt: '2026-11-25T05:10:00Z', text: 'Сигнал получен' },
      completions: [{ activityId: 'deploy', report: { id: 'report-1', authorId: 'hq-blue', submittedAt: at, text: 'Район занят' } }], criteria: { c1: true } };
    const call = () => fetch(`http://127.0.0.1:${port}/kshvi/exercises/${created.id}/readiness/advance`, {
      method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'x-csrf-token': login.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    const first = await call();
    expect(first.status).toBe(200);
    const card = await first.json();
    expect(latest(card).readinessStates[0].status).toBe('READY');
    input.expectedRevision = card.revision;
    const second = await call();
    const repeated = await second.json();
    expect(latest(repeated).readinessStates[0]).toEqual(latest(card).readinessStates[0]);
    expect(latest(repeated).readinessStates[0].history).toHaveLength(latest(card).readinessStates[0].history.length);
    expect((await store.get('org', created.id))?.revision).toBe(card.revision);
  } finally { await service.close(); }
});
