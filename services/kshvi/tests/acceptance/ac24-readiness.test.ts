import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { advanceReadiness, authorizePartialReadiness, type ReadinessActivity, type ReadinessStage } from '../../../../packages/kshvi/src/forces/readiness-stage';
import { assertReadyForTask, consumePartialReadinessAuthorization, type ReadinessEffectProfile, type ReadinessState } from '../../../../packages/kshvi/src/forces/readiness';
import { advanceTask, type TaskExecution } from '../../../../packages/kshvi/src/simulation/movement';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

const START = '2030-01-01T06:00:00.000Z';
const DUE = '2030-01-01T08:00:00.000Z';
const profile: ReadinessEffectProfile = {
  id: 'readiness-effects-ac24', version: 1, status: 'APPROVED', approvedBy: 'Методист',
  rules: [
    { code: 'SIGNAL_NOT_RECEIVED', orderProcessingDelayMinutes: 20, capabilityFactor: 0.8, movementFactor: 0.7, resourceFactor: 1 },
    { code: 'PERSONNEL_SHORTAGE', orderProcessingDelayMinutes: 5, capabilityFactor: 0.7, movementFactor: 0.9, resourceFactor: 1 },
    { code: 'EQUIPMENT_UNSERVICEABLE', orderProcessingDelayMinutes: 0, capabilityFactor: 0.5, movementFactor: 0.6, resourceFactor: 1 },
    { code: 'SUPPLIES_NOT_REPLENISHED', orderProcessingDelayMinutes: 0, capabilityFactor: 0.9, movementFactor: 0.8, resourceFactor: 0.4 },
    { code: 'AREA_NOT_OCCUPIED', orderProcessingDelayMinutes: 0, capabilityFactor: 0.8, movementFactor: 0.5, resourceFactor: 1 },
  ],
};
function activity(id: string, kind: ReadinessActivity['kind']): ReadinessActivity {
  return {
    id, kind, title: `Мероприятие ${id}`, responsibleNodeId: `node-${id}`, startAt: START, dueAt: DUE,
    durationMinutes: 30, dependsOn: [], requiresSignal: false, preconditions: [], resources: [], reportRequired: true,
    criterion: { id: `criterion-${id}`, description: `Критерий ${id}` },
  };
}
function stage(id: string, kinds: readonly ReadinessActivity['kind'][]): ReadinessStage {
  const activities = kinds.map((kind, index) => activity(`${id}-${index}`, kind));
  return {
    id: `stage-${id}`, title: 'Обеспечение боевой готовности', startsAt: START, dueAt: DUE,
    signal: { id: `signal-${id}`, sentAt: START, senderNodeId: 'hq-ac24' }, activities,
    completionCriterionIds: activities.map(item => item.criterion.id), adverseOutcomes: ['PARTIAL', 'FAILED'],
  };
}
function initialState(id: string, codes: ReadinessState['limitations']): ReadinessState {
  return {
    subjectId: id, subjectKind: 'FORCE', initialLevel: 0.4, requiredLevel: 0.8, status: 'PARTIAL',
    completedActivityIds: [], activityRecords: [], reports: [], criterionResults: {}, limitations: codes, authorizations: [], history: [],
  };
}
function task(orderId: string): TaskExecution {
  return {
    id: `task-${orderId}`, elementId: `element-${orderId}`, orderId, receivedOrderIds: [orderId], stage: 'PREPARATION',
    route: { routeLengthMeters: 1000, remainingMeters: 1000, travelledMeters: 0, delayMinutes: 0 },
    elapsedMinutes: 0, resources: [], reportIds: [], limitations: [], history: [],
  };
}

it('AC-24: SEALED не завершает готовность, а разрешённый первый приказ сохраняет разные последствия трёх сил', { timeout: 120_000 }, async () => {
  const moduleOutput = execFileSync('npx', ['vitest', 'run', 'packages/kshvi/tests/readiness.test.ts', 'packages/kshvi/tests/readiness-authorization.test.ts'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  expect(moduleOutput).toContain('2 passed');

  const signalStage = stage('signal', ['SIGNAL']);
  const signalActivity = signalStage.activities[0];
  const signalState = advanceReadiness(signalStage, initialState('force-signal', []), {
    at: '2030-01-01T07:00:00.000Z', signalReceivedAt: null,
    completions: [{
      activityId: signalActivity.id,
      report: { id: 'report-signal-ac24', authorId: signalActivity.responsibleNodeId, submittedAt: '2030-01-01T06:35:00.000Z', text: 'Передача выполнена, получение не подтверждено' },
    }],
    criteria: { [signalActivity.criterion.id]: true },
  });
  expect(signalState.status).toBe('PARTIAL');
  expect(signalState.completedActivityIds).toEqual([signalActivity.id]);
  expect(signalState.reports.map(report => report.id)).toEqual(['report-signal-ac24']);
  expect(signalState.limitations.map(item => item.code)).toEqual(['SIGNAL_NOT_RECEIVED']);

  const personnelStage = stage('personnel', ['MANNING', 'EQUIPMENT']);
  const supplyStage = stage('supply', ['SUPPLIES', 'AREA']);
  const cases = [
    {
      stage: signalStage, state: signalState,
      codes: ['SIGNAL_NOT_RECEIVED'],
    },
    {
      stage: personnelStage,
      state: initialState('force-personnel', [
        { code: 'PERSONNEL_SHORTAGE', since: START, details: 'Недокомплект личного состава' },
        { code: 'EQUIPMENT_UNSERVICEABLE', since: START, details: 'Техника неисправна' },
      ]),
      codes: ['PERSONNEL_SHORTAGE', 'EQUIPMENT_UNSERVICEABLE'],
    },
    {
      stage: supplyStage,
      state: initialState('force-supply', [
        { code: 'SUPPLIES_NOT_REPLENISHED', since: START, details: 'Запасы не пополнены' },
        { code: 'AREA_NOT_OCCUPIED', since: START, details: 'Район не занят' },
      ]),
      codes: ['SUPPLIES_NOT_REPLENISHED', 'AREA_NOT_OCCUPIED'],
    },
  ] as const;

  const leader = { userId: 'chief-ac24', activeRole: 'LEADER', organizationId: 'org-ac24', authorities: ['readiness.partial.override'] };
  const results = cases.map((item, index) => {
    const orderId = `order-ac24-${index}`;
    const blocked = assertReadyForTask({ scenarioState: 'SEALED', readiness: item.state, allowPartial: true, orderId, profile });
    expect(blocked).toMatchObject({ allowed: false, status: 'BLOCKED', missing: item.codes });
    const decision = {
      decisionId: `decision-ac24-${index}`, orderId, limitations: [...item.codes], authorized: true,
      actorId: leader.userId, actorRole: leader.activeRole, authorities: leader.authorities,
      basis: 'План учения', rationale: 'Продолжить с сохранением ограничений', at: DUE,
    };
    if (index === 0) {
      expect(() => authorizePartialReadiness(item.state, decision, { ...leader, userId: 'attacker-ac24', authorities: [] })).toThrow('уполномочен');
    }
    const authorized = authorizePartialReadiness(item.state, decision, leader);
    expect(authorized.limitations).toEqual(item.state.limitations);
    const check = assertReadyForTask({ scenarioState: 'SEALED', readiness: authorized, allowPartial: true, orderId, profile });
    expect(check).toMatchObject({ allowed: true, status: 'ALLOWED', missing: item.codes });
    expect(check.explanation.join(' ')).toContain(decision.decisionId);
    const consumed = consumePartialReadinessAuthorization(authorized, { orderId, profile });
    expect(consumed.state.authorizations[0].consumedByOrderId).toBe(orderId);
    expect(consumePartialReadinessAuthorization(consumed.state, { orderId, profile }).state).toEqual(consumed.state);
    const moved = advanceTask(task(orderId), {
      commandId: `advance-ac24-${index}`, action: 'ADVANCE', at: DUE,
      movement: { speedKph: 0.6, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
      readiness: check.effects,
    });
    return { ...item, authorized, blocked, check, consumed: consumed.state, moved };
  });
  expect(results[0].moved.task.route.delayMinutes).toBe(20);
  expect(results[1].check.effects.capabilityFactor).toBe(0.35);
  expect(results[2].check.effects.resourceFactor).toBe(0.4);
  expect(results[2].check.effects.movementFactor).toBe(0.4);
  expect(results.map(result => result.moved.task.limitations)).toEqual([[], [], []]);
  expect(results.every(result => result.moved.task.stage === 'PARTIAL')).toBe(true);

  const readyCheck = assertReadyForTask({ scenarioState: 'SEALED', readiness: 'READY', missing: [], allowPartial: false, profile });
  const readyMovement = advanceTask(task('order-ready-ac24'), {
    commandId: 'advance-ready-ac24', action: 'ADVANCE', at: DUE,
    movement: { speedKph: 0.6, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 }, readiness: readyCheck.effects,
  });
  expect(readyMovement.task.route.travelledMeters).toBe(600);
  // 20 минут обработки сигнала занимают треть часового интервала: 600 × 0,7 × 2/3 = 280 м.
  expect(results[0].moved.task.route.travelledMeters).toBe(280);
  // 5 минут обработки из-за недокомплекта также уменьшают движение: 600 × 0,54 × 55/60 = 297 м.
  expect(results[1].moved.task.route.travelledMeters).toBe(297);
  expect(results[2].moved.task.route.travelledMeters).toBe(240);
  expect(results[2].moved.task.route.travelledMeters).toBeLessThan(readyMovement.task.route.travelledMeters);

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac24';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: 'readiness-ac24', revision: profile.version, sha256: hashCanonical({ stages: cases.map(item => item.stage), profile }) };
  const journalPath = `${directory}/journal.json`;
  const comparisonPath = `${directory}/first-order-comparison.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const journal = JSON.parse(JSON.stringify({ runId, commit, moduleOutput, results }));
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    forcesWithPartialReadiness: results.length, blockedBeforeAuthorization: results.filter(result => result.blocked.status === 'BLOCKED').length,
    authorizedTransitions: results.filter(result => result.check.allowed).length, readyDistanceMeters: readyMovement.task.route.travelledMeters,
    signalDelayMinutes: results[0].moved.task.route.delayMinutes,
    personnelEquipmentDistanceMeters: results[1].moved.task.route.travelledMeters,
    supplyAreaDistanceMeters: results[2].moved.task.route.travelledMeters,
    duplicateAuthorizationsApplied: 0,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(comparisonPath, JSON.stringify({ ready: readyMovement, partial: results.map(result => ({ subjectId: result.state.subjectId, check: result.check, moved: result.moved })) }, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-24 завершён\nrunId: ${runId}\ncommit: ${commit}\nSEALED не повысил готовность; сигнал, недокомплект/техника и запасы/район дали разные последствия; переходы до разрешения блокировались; решение руководителя и повтор его применения сохранены; первый приказ реально замедлился.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-24.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: journalSha256, eventCount: results.reduce((sum, result) => sum + result.authorized.history.length + result.moved.task.history.length, 0) },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical({ scenarioState: 'SEALED', readiness: 'PARTIAL' }), journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Доменный этап и влияние на первый приказ подтверждены; визуальная и методическая оценка отображения на конкретном стенде выполняется отдельно.'],
    artifacts: [journalPath, comparisonPath, protocolPath, metricsPath],
  }, null, 2));
});
