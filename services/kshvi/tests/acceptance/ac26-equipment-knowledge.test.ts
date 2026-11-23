import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createService } from '@def-ops/service-kit';
import { modernCorpus } from '@def-ops/knowledge';
import { expect, it } from 'vitest';
import { assertModernImportReady, commitModernImport, previewModernImport } from '../../../../packages/kshvi/src/forces/modern-import';
import { createEquipmentHolding, type EquipmentHoldingInput, type EquipmentMeasure, type EquipmentType } from '../../../../packages/kshvi/src/forces/equipment';
import { allocateEquipment, assignEquipmentTask, evaluateEquipmentTask, transitionEquipment } from '../../../../packages/kshvi/src/forces/equipment-state';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { buildForceRouter, MemoryModernImportStore } from '../../src/http/force-routes';

const AT = '2030-01-01T06:00:00.000Z';
const LATER = '2030-01-01T07:00:00.000Z';
const source = { sourceId: 'constructor-ac26', revision: 1, sha256: 'a'.repeat(64), note: 'Учебный сценарный тип' } as const;
function measure(value: number | null, unit: string): EquipmentMeasure {
  return value === null ? { status: 'UNKNOWN', value: null, unit, reason: 'Нет утверждённого значения' } : { status: 'KNOWN', value, unit, source };
}
const counts = (serviceable: number, degraded = 0, underRepair = 0, damaged = 0, destroyed = 0, unknown = 0) => ({ SERVICEABLE: serviceable, DEGRADED: degraded, UNDER_REPAIR: underRepair, DAMAGED: damaged, DESTROYED: destroyed, UNKNOWN: unknown });
const equipmentType: EquipmentType = {
  id: 'pontoon-ac26', revision: 1, sha256: 'b'.repeat(64), title: 'Понтон AC-26', movementClass: 'WHEELED',
  massTonnes: measure(8, 'tonne'),
  dimensions: { lengthM: measure(6, 'm'), widthM: measure(3, 'm'), heightM: measure(2, 'm') },
  transportCapacity: { payloadTonnes: measure(2, 'tonne'), personnel: measure(4, 'person') },
  operatingResources: [{ resourceId: 'fuel', amountPerUnit: 0.1, unit: 'tonne', source }],
  allowedTasks: ['CROSSING_BUILD', 'TRANSPORT'], environmentLimits: ['ROAD_WEIGHT_LIMIT', 'CROSSING_CAPACITY'],
};
function holdingInput(overrides: Partial<EquipmentHoldingInput> = {}): EquipmentHoldingInput {
  return {
    id: 'holding-ac26', forceId: 'force-ac26', accounting: 'AGGREGATE', equipmentType,
    authorized: 1, actual: 1, stateCounts: counts(1),
    crew: { requiredPerUnit: measure(2, 'person'), assigned: measure(2, 'person') }, distribution: [], source,
    ...overrides,
  };
}

it('AC-26: серверные копии современной базы и конструктора сохраняют происхождение, а ремонт восстанавливает возможность', { timeout: 120_000 }, async () => {
  const uiOutput = execFileSync('npx', ['vitest', 'run', 'apps/editor/tests/kshvi-knowledge-import.test.tsx'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  expect(uiOutput).toContain('3 passed');

  const record = modernCorpus.representatives[0];
  const originalRecord = JSON.stringify(record);
  const sourceReference = {
    sourceRecordId: record.id, sourceRevision: 1,
    sourceHash: createHash('sha256').update(originalRecord).digest('hex'), recordKind: 'REPRESENTATIVE' as const,
    modelInputs: false as const, simulationValidated: false as const, characteristics: [],
  };
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'director-ac26', username: 'director-ac26', password: 'secret123', organizationId: 'org-ac26',
    roles: [{ id: 'director-role-ac26', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise'] }],
  });
  const login = await sessions.login('director-ac26', 'secret123');
  await sessions.selectRole(login.token, 'director-role-ac26');
  const store = new MemoryModernImportStore();
  const service = createService({ name: 'kshvi-ac26', port: 0, router: buildForceRouter(store, sessions) });
  const port = await service.listen();
  let firstCopy: any;
  let secondCopy: any;
  let listedCopies: any[];
  try {
    const call = async () => fetch(`http://127.0.0.1:${port}/kshvi/forces/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.token}`, 'X-CSRF-Token': login.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: sourceReference, sideId: 'blue', parentNodeId: 'node-ac26', scenarioValues: [] }),
    });
    const first = await call();
    const second = await call();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    firstCopy = await first.json();
    secondCopy = await second.json();
    const listed = await fetch(`http://127.0.0.1:${port}/kshvi/forces/import?sideId=blue`, {
      headers: { Authorization: `Bearer ${login.token}`, 'X-CSRF-Token': login.csrfToken },
    });
    expect(listed.status).toBe(200);
    listedCopies = await listed.json() as any[];
  } finally {
    await service.close();
  }
  expect(firstCopy.id).not.toBe(secondCopy.id);
  expect(firstCopy).toMatchObject({
    sourceRecordId: record.id, sourceRevision: 1, sourceHash: sourceReference.sourceHash,
    recordKind: 'REPRESENTATIVE', sideId: 'blue', parentNodeId: 'node-ac26', modelInputs: false, simulationValidated: false,
  });
  expect(firstCopy.preview.tree.length + firstCopy.preview.equipment.length).toBeGreaterThan(0);
  expect(firstCopy.preview.sources.length).toBeGreaterThan(0);
  expect(listedCopies!).toHaveLength(2);
  expect(JSON.stringify(record)).toBe(originalRecord);

  const constructorSource = {
    sourceRecordId: 'constructor-ac26', sourceRevision: 1, sourceHash: 'c'.repeat(64),
    modelInputs: false as const, simulationValidated: false as const, characteristics: [{ field: 'speed', value: null }],
  };
  const preview = previewModernImport(constructorSource);
  expect(preview.unknown).toEqual(['speed']);
  expect(assertModernImportReady(preview, ['speed'])).toEqual({ status: 'REQUIRES_REVIEW', unknown: ['speed'] });
  expect(() => commitModernImport(preview, {
    sideId: 'blue', parentNodeId: 'node-ac26', scenarioValues: [{ field: 'speed', value: 60 }], idFactory: () => 'constructor-copy-ac26',
  })).toThrow('источник или учебное допущение');
  const constructorCopy = commitModernImport(preview, {
    sideId: 'blue', parentNodeId: 'node-ac26',
    scenarioValues: [{ field: 'speed', value: 60, source: { kind: 'ASSUMPTION', note: 'Учебное допущение только для сценарной копии AC-26' } }],
    idFactory: () => 'constructor-copy-ac26',
  });
  expect(constructorCopy).toMatchObject({ id: 'constructor-copy-ac26', sideId: 'blue', parentNodeId: 'node-ac26', modelInputs: false, simulationValidated: false });
  expect(constructorCopy.scenarioValues[0].source?.kind).toBe('ASSUMPTION');
  expect(constructorCopy.sourceRecordId).not.toBe(record.id);

  const initial = createEquipmentHolding(holdingInput());
  expect(initial).toMatchObject({ authorized: 1, actual: 1, stateCounts: counts(1) });
  const allocated = allocateEquipment(initial, [{ targetId: 'child-ac26', quantity: 1 }]);
  expect(allocated.unallocated).toBe(0);
  expect(allocateEquipment(allocated, [{ targetId: 'child-ac26', quantity: 1 }]).distribution).toHaveLength(1);
  const task = { kind: 'CROSSING_BUILD', requiredUnits: 1 } as const;
  const allowed = evaluateEquipmentTask({ holdings: [initial], task });
  expect(allowed).toMatchObject({ status: 'ALLOWED', allowed: true, serviceableUnits: 1 });
  const assigned = assignEquipmentTask(initial, { assignmentId: 'assignment-ac26', kind: 'CROSSING_BUILD', quantity: 1, at: AT, causeId: 'order-ac26' });
  expect(assignEquipmentTask(assigned, { assignmentId: 'assignment-ac26', kind: 'CROSSING_BUILD', quantity: 1, at: AT, causeId: 'order-ac26' })).toBe(assigned);

  const degraded = transitionEquipment(initial, { from: 'SERVICEABLE', to: 'DEGRADED', quantity: 1, causeId: 'fault-ac26', eventId: 'fault-ac26', at: AT, reason: 'Повреждение перед задачей', resources: [] });
  const blocked = evaluateEquipmentTask({ holdings: [degraded], task });
  expect(blocked).toMatchObject({ status: 'BLOCKED', allowed: false, serviceableUnits: 0 });
  const repairing = transitionEquipment(degraded, { from: 'DEGRADED', to: 'UNDER_REPAIR', quantity: 1, causeId: 'repair-order-ac26', eventId: 'repair-start-ac26', at: AT, reason: 'Начат ремонт', resources: [] });
  const repaired = transitionEquipment(repairing, {
    from: 'UNDER_REPAIR', to: 'SERVICEABLE', quantity: 1, causeId: 'repair-complete-ac26', eventId: 'repair-finish-ac26', at: LATER, reason: 'Ремонт завершён',
    resources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }], availableResources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }],
  });
  const repeated = evaluateEquipmentTask({ holdings: [repaired], task });
  expect(repeated).toMatchObject({ status: 'ALLOWED', allowed: true, serviceableUnits: 1 });
  expect(repaired.resourceBalances['spare-part']).toMatchObject({ amount: 0 });
  expect(repaired.history.map(event => event.eventId)).toEqual(['fault-ac26', 'repair-start-ac26', 'repair-finish-ac26']);
  expect(repaired.initial.stateCounts).toEqual(counts(1));
  expect(transitionEquipment(repaired, {
    from: 'UNDER_REPAIR', to: 'SERVICEABLE', quantity: 1, causeId: 'repair-complete-ac26', eventId: 'repair-finish-ac26', at: LATER, reason: 'Ремонт завершён',
    resources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }], availableResources: [{ resourceId: 'spare-part', amount: 1, unit: 'pcs' }],
  })).toBe(repaired);

  const unknownMass = createEquipmentHolding(holdingInput({ equipmentType: { ...equipmentType, massTonnes: measure(null, 'tonne') } }));
  expect(evaluateEquipmentTask({ holdings: [unknownMass], task: { kind: 'TRANSPORT', requiredUnits: 1, maxMassTonnes: 10 } })).toMatchObject({ status: 'REQUIRES_REVIEW', allowed: false, unknown: ['massTonnes'] });

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac26';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: 'equipment-knowledge-ac26', revision: 1, sha256: hashCanonical({ sourceReference, constructorSource, equipmentType }) };
  const journalPath = `${directory}/journal.json`;
  const equipmentPath = `${directory}/equipment-history.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const journal = JSON.parse(JSON.stringify({
    runId, commit, uiOutput, firstCopy, secondCopy, listedCopies, constructorCopy,
    initial, allocated, allowed, assigned, degraded, blocked, repairing, repaired, repeated, unknownMass,
  }));
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    independentSourceCopies: 2, sourceRecordUnchanged: 1, constructorCopies: 1,
    requiredUnknownReviews: 2, initiallyAllowedTasks: 1, damagedTasksBlocked: 1, repairedTasksAllowed: 1,
    repairResourceRemaining: repaired.resourceBalances['spare-part'].amount, duplicateAllocations: 0,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(equipmentPath, JSON.stringify({ initial: initial.initial, history: repaired.history, resourceBalances: repaired.resourceBalances }, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-26 завершён\nrunId: ${runId}\ncommit: ${commit}\nДве серверные копии базы и копия конструктора независимы; источник и UNKNOWN сохранены; непроверенные входы не стали нормативом; повреждение заблокировало задачу; ремонт с ресурсом восстановил её без двойного учёта.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-26.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: journalSha256, eventCount: repaired.history.length + 3 },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical({ corpusRecord: record.id, sourceHash: sourceReference.sourceHash }), journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Серверный импорт и событийный автомат техники проверены; содержательная оценка конкретных военных характеристик остаётся предметом методической AC-30.'],
    artifacts: [journalPath, equipmentPath, protocolPath, metricsPath],
  }, null, 2));
});
