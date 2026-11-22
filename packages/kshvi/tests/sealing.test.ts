import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  READINESS_AREAS,
  REHEARSAL_CHECKS,
  SEALING_COMMAND_SCHEMAS,
  SEALING_JSON_SCHEMA,
  createAutonomousArchive,
  createInitialWorld,
  createInstanceRegistry,
  invalidateReadiness,
  reviseSealedScenario,
  runRehearsal,
  sealScenario,
  startInstance,
  transitionInstance,
  transitionLifecycle,
  type RehearsalReport,
  type SealScenarioInput,
  type SealedScenario,
} from '../src/scenario/sealing';
import {
  addInitialMapMarker,
  approveInitialMap,
  createInitialSituationMap,
  type ApprovedInitialMap,
} from '../src/scenario/initial-map';
import { hashCanonical } from '../src/scenario/initial-map-hash';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-02T06:00:00+03:00';
const scenario = {
  id: 'scenario-ac01', title: 'Многоступенчатое учение', sides: ['blue', 'red'],
  trainedLevels: 3, stages: ['stage-1', 'stage-2'], mapZoom: 8,
};

function validMap(): ApprovedInitialMap {
  const map = createInitialSituationMap({
    id: 'map-ac01', revision: 1,
    environment: { snapshotId: 'env-1', manifestSha256: hashA, bounds: [0, 0, 1, 1] },
    initialOperationalAt: start, timeZone: 'Europe/Moscow', weatherFrameRef: 'weather-1', terrainStateRef: 'terrain-1',
    symbolSet: { id: 'symbols', revision: 1, sha256: hashB }, attribution: ['OSM'],
  });
  return approveInitialMap(addInitialMapMarker(map, {
    id: 'force', revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [0.2, 0.2] }, sourceId: 'source', authorId: 'author', eventId: 'event',
    validFrom: start, validUntil: end, state: 'OBSERVED', confidence: 0.8,
    uncertainty: { radiusM: 10, note: '' }, visibility: { sideIds: ['blue'] }, links: { forceId: 'force-1' },
    sideId: 'blue', symbol: { id: 'force', version: 'v1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'source.doc', sourcePage: 1 },
  }));
}

function rehearsalFixture(): RehearsalReport {
  return {
    schemaVersion: 1,
    id: 'rehearsal-ac01',
    scenarioSha256: hashCanonical(scenario),
    full: true,
    isolated: true,
    status: 'PASSED',
    eventLogId: 'rehearsal-log-ac01',
    officialEventLogId: 'official-log-ac01',
    checks: Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, true])),
  };
}

function sealInput(): SealScenarioInput {
  return {
    id: 'scenario-ac01',
    revision: 3,
    state: 'APPROVED',
    scenario,
    issues: [],
    requiredConfirmations: [...READINESS_AREAS],
    confirmations: READINESS_AREAS.map(area => ({
      id: `confirmation-${area}`, area, userId: `user-${area}`, role: 'RESPONSIBLE',
      confirmedAt: start, subjectHash: hashA, dependsOn: [],
    })),
    confirmationSubjects: Object.fromEntries(READINESS_AREAS.map(area => [area, hashA])),
    rehearsal: rehearsalFixture(),
    initialMap: validMap(),
    environmentSnapshot: { manifestSha256: hashA, contentRef: 'environment/hash', autonomous: true },
    expectedEnvironmentSha256: hashA,
    officialEventLogId: 'official-log-ac01',
    hashes: {
      weather: hashB, elevation: hashB, symbols: hashB, agents: hashB, eventLibrary: hashB,
      models: hashB, roles: hashB, communications: hashB, documents: hashB, rehearsal: hashC,
    },
    sealedAt: start,
  };
}

function sealedFixture(): SealedScenario {
  return sealScenario(sealInput());
}

describe('PREP-05/10/11: блокировка и персональная готовность', () => {
  it('не фиксирует сценарий с ошибкой и неподтверждённым контуром', () => {
    expect(() => sealScenario({
      state: 'APPROVED', issues: [{ severity: 'ERROR', code: 'MAP_INVALID' }],
      confirmations: [], requiredConfirmations: ['environment'],
    })).toThrow('MAP_INVALID');
    const input = sealInput();
    input.confirmations = input.confirmations.filter(item => item.area !== 'DOCUMENTS');
    expect(() => sealScenario(input)).toThrow('DOCUMENTS');
  });

  it('не принимает общую кнопку готовности или чужое устаревшее подтверждение', () => {
    const input = sealInput();
    input.confirmations = input.confirmations.map(item => item.area === 'MODEL_PROFILE' ? { ...item, userId: '', subjectHash: hashC } : item);
    expect(() => sealScenario(input)).toThrow('PERSONAL_CONFIRMATION_INVALID');
  });

  it('принимает WARNING только с действующим персональным основанием', () => {
    const input = sealInput();
    input.issues = [{ severity: 'WARNING', code: 'PRINT_REVIEW', area: 'DOCUMENTS', message: 'Проверить печать', waivable: true }];
    expect(() => sealScenario(input)).toThrow('WARNING_ACCEPTANCE');
    input.warningAcceptances = [{
      code: 'PRINT_REVIEW', authorId: 'chief', reason: 'Проверено на бумаге', expiresAt: end, scope: 'только печать',
    }];
    expect(() => sealScenario(input)).not.toThrow();
    input.warningAcceptances = [{ ...input.warningAcceptances[0], expiresAt: start }];
    expect(() => sealScenario(input)).toThrow('WARNING_ACCEPTANCE_EXPIRED');
  });

  it('не разрешает принять неснимаемое нарушение как предупреждение', () => {
    const input = sealInput();
    input.issues = [{ severity: 'WARNING', code: 'VISIBILITY_LEAK', area: 'VISIBILITY', message: 'Утечка', waivable: false }];
    input.warningAcceptances = [{ code: 'VISIBILITY_LEAK', authorId: 'chief', reason: 'ошибочно', expiresAt: end, scope: 'все' }];
    expect(() => sealScenario(input)).toThrow('NOT_WAIVABLE');
  });
});

describe('PREP-08: полная изолированная сухая репетиция', () => {
  it('выполняет все проверки на копии и не смешивает журнал с официальным', async () => {
    const original = { ...scenario, mutable: { value: 1 } };
    const report = await runRehearsal({
      scenario: original,
      officialEventLogId: 'official-log',
      rehearsalId: 'rehearsal-1',
      eventLogId: 'rehearsal-log-1',
    }, async isolated => {
      isolated.scenario.mutable.value = 2;
      return {
        status: 'PASSED', eventLogId: 'rehearsal-log-1',
        checks: Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, true])),
      };
    });
    expect(report).toMatchObject({ full: true, isolated: true, status: 'PASSED', officialEventLogId: 'official-log' });
    expect(original.mutable.value).toBe(1);
    expect(REHEARSAL_CHECKS).toHaveLength(14);
  });

  it('отклоняет общий журнал и неполный или неуспешный прогон', async () => {
    await expect(runRehearsal({ scenario, officialEventLogId: 'same', rehearsalId: 'r', eventLogId: 'same' }, async () => ({
      status: 'PASSED', eventLogId: 'same', checks: Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, true])),
    }))).rejects.toThrow('REHEARSAL_ISOLATION_REQUIRED');
    const input = sealInput();
    input.rehearsal = { ...rehearsalFixture(), full: false };
    expect(() => sealScenario(input)).toThrow('REHEARSAL_REQUIRED');
    input.rehearsal = { ...rehearsalFixture(), checks: { ...rehearsalFixture().checks, RECOVERY: false } };
    expect(() => sealScenario(input)).toThrow('REHEARSAL_CHECKS');
  });
});

describe('PREP-05/06 и AC-01/22: SEALED, начальный мир и архив', () => {
  it('фиксирует канонический сценарий и хеш исходной карты во всех контейнерах', () => {
    const sealed = sealedFixture();
    expect(sealed.state).toBe('SEALED');
    expect(sealed.scenarioSha256).toBe(hashCanonical(scenario));
    expect(sealed.hashes.initialMap).toBe(sealed.initialMap.sha256);
    expect(sealed.hashes.environment).toBe(hashA);
    const world = createInitialWorld(sealed);
    const archive = createAutonomousArchive(sealed);
    expect(world.initialMapSha256).toBe(sealed.initialMap.sha256);
    expect(archive.initialWorld.initialMapSha256).toBe(sealed.initialMap.sha256);
    expect(archive.hashes.initialMap).toBe(sealed.initialMap.sha256);
    expect(archive.initialMap.layers).toEqual(sealed.initialMap.layers);
    expect(archive.initialMap.markers[0].symbol).toEqual(sealed.initialMap.markers[0].symbol);
    expect(archive.environmentSnapshot).toEqual(sealed.environmentSnapshot);
    expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('обнаруживает изменение карты, среды или канонического сценария после подтверждений', () => {
    const changedMap = sealInput();
    changedMap.initialMap = { ...validMap(), revision: 3 };
    expect(() => sealScenario(changedMap)).toThrow('INITIAL_MAP_HASH_INVALID');
    const changedEnvironment = sealInput();
    changedEnvironment.expectedEnvironmentSha256 = hashC;
    expect(() => sealScenario(changedEnvironment)).toThrow('ENVIRONMENT_HASH_INVALID');
    const changedScenario = sealInput();
    changedScenario.scenario = { ...scenario, title: 'Изменено после репетиции' };
    expect(() => sealScenario(changedScenario)).toThrow('REHEARSAL_SCENARIO_HASH');
  });

  it('устаревают только зависимые подтверждения, а полный прогон обязателен снова', () => {
    const sealed = sealedFixture();
    const input = sealInput();
    const confirmations = input.confirmations.map(item => item.area === 'MODEL_PROFILE'
      ? { ...item, dependsOn: ['ENVIRONMENT_MAP' as const] }
      : item);
    const invalidated = invalidateReadiness(confirmations, { changedAreas: ['ENVIRONMENT_MAP'] });
    expect(invalidated.staleConfirmationIds).toEqual(expect.arrayContaining(['confirmation-ENVIRONMENT_MAP', 'confirmation-MODEL_PROFILE']));
    expect(invalidated.staleConfirmationIds).not.toContain('confirmation-DOCUMENTS');
    expect(invalidated.validConfirmations).toHaveLength(READINESS_AREAS.length - 2);
    expect(invalidated.requiresFullRehearsal).toBe(true);
    const revised = reviseSealedScenario(sealed, { ...scenario, title: 'Новая редакция' }, {
      changedAreas: ['ENVIRONMENT_MAP'],
    });
    expect(revised.state).toBe('DRAFT');
    expect(revised.revision).toBe(4);
    expect(revised.rehearsal).toBeNull();
    expect(revised.previousSealSha256).toBe(sealed.scenarioSha256);
    expect(sealed.state).toBe('SEALED');
  });
});

describe('ARCH-20–22: жизненный цикл и изолированные сеансы', () => {
  it('проходит штатный и аварийный жизненный цикл только серверными командами с ролями', () => {
    expect(transitionLifecycle('DRAFT', 'SUBMIT', { serverCommand: true, role: 'AUTHOR' })).toBe('IN_REVIEW');
    expect(transitionLifecycle('IN_REVIEW', 'APPROVE', { serverCommand: true, role: 'APPROVER' })).toBe('APPROVED');
    expect(transitionLifecycle('APPROVED', 'SEAL', { serverCommand: true, role: 'DIRECTOR', sealedArtifact: true })).toBe('SEALED');
    expect(transitionLifecycle('SEALED', 'CANCEL', { serverCommand: true, role: 'DIRECTOR' })).toBe('CANCELLED');
    expect(() => transitionLifecycle('DRAFT', 'SUBMIT', { serverCommand: false, role: 'AUTHOR' })).toThrow('SERVER_COMMAND_REQUIRED');
    expect(() => transitionLifecycle('DRAFT', 'APPROVE', { serverCommand: true, role: 'AUTHOR' })).toThrow('TRANSITION_FORBIDDEN');
    expect(() => transitionLifecycle('ACTIVE', 'ARCHIVE', { serverCommand: true, role: 'DIRECTOR' })).toThrow('TRANSITION_FORBIDDEN');
  });

  it('запускает только SEALED и делает повтор по ключу идемпотентным', () => {
    const registry = createInstanceRegistry();
    const sealed = sealedFixture();
    const command = { instanceId: 'instance-1', idempotencyKey: 'start-1', seed: 'seed-1', actorRole: 'DIRECTOR', serverCommand: true };
    const first = startInstance(sealed, command, registry);
    const repeated = startInstance(sealed, command, registry);
    expect(repeated).toBe(first);
    expect(registry.count).toBe(1);
    expect(first).toMatchObject({ state: 'ACTIVE', scenarioSha256: sealed.scenarioSha256, eventLogId: 'events-instance-1' });
    expect(() => startInstance({ ...sealed, state: 'APPROVED' }, command, registry)).toThrow('SEALED_REQUIRED');
    expect(() => startInstance(sealed, { ...command, instanceId: 'other' }, registry)).toThrow('IDEMPOTENCY_CONFLICT');
    expect(() => startInstance(sealed, { ...command, idempotencyKey: 'start-2', instanceId: 'instance-2', serverCommand: false }, registry)).toThrow('SERVER_COMMAND_REQUIRED');
  });

  it('разделяет журналы и зерна двух сеансов одной редакции', () => {
    const registry = createInstanceRegistry();
    const sealed = sealedFixture();
    const first = startInstance(sealed, { instanceId: 'instance-1', idempotencyKey: 'start-1', seed: 'seed-1', actorRole: 'DIRECTOR', serverCommand: true }, registry);
    const second = startInstance(sealed, { instanceId: 'instance-2', idempotencyKey: 'start-2', seed: 'seed-2', actorRole: 'DIRECTOR', serverCommand: true }, registry);
    expect(registry.count).toBe(2);
    expect(first.eventLogId).not.toBe(second.eventLogId);
    expect(first.events).not.toBe(second.events);
    expect(first.seed).not.toBe(second.seed);
    expect(first.scenarioSha256).toBe(second.scenarioSha256);
  });

  it('поддерживает ACTIVE↔PAUSED, COMPLETED/ABORTED и ARCHIVED без потери журнала', () => {
    const registry = createInstanceRegistry();
    const sealed = sealedFixture();
    const active = startInstance(sealed, { instanceId: 'instance-1', idempotencyKey: 'start-1', seed: 'seed-1', actorRole: 'DIRECTOR', serverCommand: true }, registry);
    const paused = transitionInstance(active, 'PAUSE', { serverCommand: true, role: 'DIRECTOR' });
    const resumed = transitionInstance(paused, 'RESUME', { serverCommand: true, role: 'DIRECTOR' });
    const completed = transitionInstance(resumed, 'COMPLETE', { serverCommand: true, role: 'DIRECTOR' });
    const archived = transitionInstance(completed, 'ARCHIVE', { serverCommand: true, role: 'ARCHIVIST' });
    expect([paused.state, resumed.state, completed.state, archived.state]).toEqual(['PAUSED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']);
    expect(archived.events).toEqual(active.events);
    const aborted = transitionInstance(paused, 'ABORT', { serverCommand: true, role: 'DIRECTOR', reason: 'Аварийное завершение' });
    expect(aborted).toMatchObject({ state: 'ABORTED', abnormalTermination: true, abortReason: 'Аварийное завершение' });
    expect(transitionInstance(aborted, 'ARCHIVE', { serverCommand: true, role: 'ARCHIVIST' }).state).toBe('ARCHIVED');
  });
});

describe('NF-19: схемы фиксации и команд', () => {
  it('содержит обязательные поля и не имеет серверных или UI-зависимостей', () => {
    expect(SEALING_JSON_SCHEMA.required).toEqual(expect.arrayContaining(['scenarioSha256', 'hashes', 'rehearsal', 'confirmations']));
    expect(SEALING_COMMAND_SCHEMAS.start.required).toEqual(expect.arrayContaining(['instanceId', 'idempotencyKey', 'seed']));
    const source = readFileSync(new URL('../src/scenario/sealing.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/node:|React|indexedDB|\bfetch\s*\(/);
  });
});


describe('PREP-05/11 и ARCH-22: обязательные условия нельзя сократить', () => {
  it('требует полный набор контуров независимо от переданного списка', () => {
    const input = sealInput();
    input.requiredConfirmations = [];
    input.confirmations = [];
    expect(() => sealScenario(input)).toThrow('CONCEPT');
  });

  it('фиксирует действительное время SEALED', () => {
    const input = sealInput();
    delete input.sealedAt;
    expect(() => sealScenario(input)).toThrow('SEALED_TIME_REQUIRED');
  });

  it('не запускает и не архивирует SEALED с повреждённым каноническим сценарием', () => {
    const sealed = sealedFixture();
    const tampered = { ...sealed, scenario: { ...scenario, title: 'Подменено' } };
    const registry = createInstanceRegistry();
    expect(() => startInstance(tampered, { instanceId: 'bad', idempotencyKey: 'bad', seed: 'bad', actorRole: 'DIRECTOR', serverCommand: true }, registry)).toThrow('SCENARIO_HASH_INVALID');
    expect(() => createInitialWorld(tampered)).toThrow('SCENARIO_HASH_INVALID');
    expect(() => createAutonomousArchive(tampered)).toThrow('SCENARIO_HASH_INVALID');
  });
});
