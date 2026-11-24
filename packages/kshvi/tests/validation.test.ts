import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SCENARIO_VALIDATION_JSON_SCHEMA,
  VALIDATION_AREAS,
  acceptValidationWarning,
  validateScenario,
  validateTrainingPreparation,
  type ScenarioAreaValidation,
  type ScenarioValidationInput,
} from '../src/scenario/validation';
import {
  addInitialMapMarker,
  approveInitialMap,
  createInitialSituationMap,
  type ApprovedInitialMap,
} from '../src/scenario/initial-map';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-01T08:00:00+03:00';

function validAreas(): Record<string, ScenarioAreaValidation> {
  return Object.fromEntries(VALIDATION_AREAS.map(area => [area, { status: 'VALID', version: 'v1' }]));
}

function validMap(): ApprovedInitialMap {
  const map = createInitialSituationMap({
    id: 'map-validation', revision: 1,
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

function validEnvironment(): NonNullable<ScenarioValidationInput['environment']> {
  return {
    snapshot: {
      manifestSha256: hashA,
      autonomy: 'COMPLETE',
      weatherContentRef: 'weather/hash',
      elevationContentRef: 'elevation/hash',
    },
    expectedManifestSha256: hashA,
    coverageComplete: true,
    atlasesAvailable: true,
    attributionComplete: true,
    elevationComplete: true,
    weatherIntervalComplete: true,
    weatherQuality: { status: 'OK', reason: 'KNOWN' },
  };
}

function validInput(): ScenarioValidationInput {
  return { areas: validAreas(), environment: validEnvironment(), initialMap: validMap() };
}

describe('PREP-09: многоуровневая проверка всех контуров', () => {
  it('проверяет каждую обязательную область и допускает полностью валидный сценарий', () => {
    const report = validateScenario(validInput());
    expect(report.checkedAreas).toEqual(VALIDATION_AREAS);
    expect(report.issues.filter(issue => issue.severity === 'ERROR')).toEqual([]);
    expect(report.status).toBe('OK');
    expect(VALIDATION_AREAS).toEqual([
      'STRUCTURE', 'COMMAND_TREE', 'ENVIRONMENT', 'INITIAL_MAP', 'TIME', 'INPUTS', 'FORCES_RESOURCES',
      'EQUIPMENT_MORALE_READINESS', 'LOGISTICS_FORMATION', 'AUTONOMY_AGENTS', 'SYMBOLS', 'COMMUNICATIONS',
      'DOCUMENTS', 'VISIBILITY', 'MODEL', 'RECOVERY',
    ]);
  });

  it('не считает отсутствующие области успешно проверенными', () => {
    const report = validateScenario({ areas: {}, environment: null });
    expect(report.status).toBe('ERROR');
    expect(report.checkedAreas).toEqual([]);
    expect(report.issues.filter(issue => issue.code === 'VALIDATION_AREA_REQUIRED')).toHaveLength(16);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'ENVIRONMENT_SNAPSHOT_REQUIRED', waivable: false }));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'INITIAL_MAP_REQUIRED', waivable: false }));
  });

  it('сохраняет ERROR, WARNING и INFO с русскими сообщениями и области проверки', () => {
    const input = validInput();
    input.areas.TIME = {
      status: 'INVALID',
      issues: [
        { code: 'STAGE_ORDER', severity: 'ERROR', message: 'Нарушен порядок этапов' },
        { code: 'DOCUMENT_REVIEW', severity: 'WARNING', message: 'Проверьте срок документа' },
        { code: 'TIME_NOTE', severity: 'INFO', message: 'Пояснение ко времени' },
      ],
    };
    const report = validateScenario(input);
    expect(report.status).toBe('ERROR');
    expect(report.issues).toContainEqual(expect.objectContaining({ area: 'TIME', code: 'STAGE_ORDER', severity: 'ERROR' }));
    expect(report.issues).toContainEqual(expect.objectContaining({ area: 'TIME', code: 'DOCUMENT_REVIEW', severity: 'WARNING', waivable: true }));
    expect(report.issues).toContainEqual(expect.objectContaining({ area: 'TIME', code: 'TIME_NOTE', severity: 'INFO' }));
  });

  it('проверяет покрытие среды и не маскирует отсутствие погодных данных пустым успехом', () => {
    const input = validInput();
    input.environment = { ...validEnvironment(), coverageComplete: false, weatherQuality: { status: 'NO_DATA', reason: 'OUTSIDE_COVERAGE' } };
    const report = validateScenario(input);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'ENVIRONMENT_COVERAGE_MISSING', severity: 'ERROR', waivable: false }));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'WEATHER_COVERAGE_MISSING', severity: 'ERROR', waivable: false }));
  });
});

describe('PREP-10: принятие предупреждений и неснимаемые нарушения', () => {
  it('требует автора, основание, срок и область принятия WARNING', () => {
    const input = validInput();
    input.areas.DOCUMENTS = { status: 'VALID', issues: [{ code: 'PRINT_REVIEW', severity: 'WARNING', message: 'Проверить печатную форму' }] };
    const warning = validateScenario(input).issues.find(issue => issue.code === 'PRINT_REVIEW')!;
    expect(() => acceptValidationWarning(warning, { authorId: '', reason: '', expiresAt: '', scope: '' }, start)).toThrow('WARNING_ACCEPTANCE');
    const accepted = acceptValidationWarning(warning, {
      authorId: 'chief', reason: 'учебное допущение', expiresAt: end, scope: 'только печатная форма',
    }, start);
    expect(accepted.acceptance).toMatchObject({ authorId: 'chief', reason: 'учебное допущение', scope: 'только печатная форма' });
    expect(() => acceptValidationWarning(warning, {
      authorId: 'chief', reason: 'просрочено', expiresAt: start, scope: 'документы',
    }, end)).toThrow('WARNING_ACCEPTANCE_EXPIRED');
  });

  it('не разрешает снять нарушение видимости, хеша или обязательного снимка', () => {
    const input = validInput();
    input.areas.VISIBILITY = { status: 'INVALID', issues: [{ code: 'SECRET_LEAK', severity: 'WARNING', message: 'Эталон попал в проекцию' }] };
    input.areas.MODEL = { status: 'INVALID', issues: [{ code: 'MODEL_HASH_MISMATCH', severity: 'WARNING', message: 'Хеш модели не совпадает' }] };
    input.initialMap = { ...validMap(), sha256: '0'.repeat(64) };
    input.environment = null;
    const report = validateScenario(input);
    for (const code of ['SECRET_LEAK', 'MODEL_HASH_MISMATCH', 'INITIAL_MAP_HASH_INVALID', 'ENVIRONMENT_SNAPSHOT_REQUIRED']) {
      const found = report.issues.find(issue => issue.code === code);
      expect(found, code).toMatchObject({ severity: 'ERROR', waivable: false });
      expect(() => acceptValidationWarning(found!, { authorId: 'a', reason: 'b', expiresAt: end, scope: 'c' }, start)).toThrow('NOT_WAIVABLE');
    }
  });
});

describe('PREP-07: подготовка людей', () => {
  it('проверяет участников, материалы, знание роли и закрытый прогон руководства', () => {
    expect(validateTrainingPreparation({
      requiredParticipantIds: ['p1'],
      plans: [{
        id: 'training-1', participantIds: ['p1'], materialIds: ['material-1'],
        roleKnowledgeChecks: [{ participantId: 'p1', role: 'TRAINEE', passed: true }],
        readiness: [{ participantId: 'p1', ready: true }],
      }],
      leadershipRehearsal: { isolated: true, traineeAccess: false },
    })).toEqual([]);
    const issues = validateTrainingPreparation({
      requiredParticipantIds: ['p1'],
      plans: [{ id: 'training-1', participantIds: [], materialIds: [], roleKnowledgeChecks: [], readiness: [] }],
      leadershipRehearsal: { isolated: false, traineeAccess: true },
    });
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'TRAINING_PARTICIPANT_REQUIRED', 'TRAINING_MATERIAL_REQUIRED', 'ROLE_KNOWLEDGE_REQUIRED',
      'TRAINING_READINESS_REQUIRED', 'STAFF_REHEARSAL_ISOLATION_REQUIRED', 'STAFF_MATERIAL_LEAK',
    ]));
  });
});

describe('NF-19: контракт чистого ядра', () => {
  it('содержит схему отчёта и не импортирует UI, хранилище или транспорт', () => {
    expect(SCENARIO_VALIDATION_JSON_SCHEMA.required).toEqual(expect.arrayContaining(['checkedAreas', 'issues', 'status']));
    const source = readFileSync(new URL('../src/scenario/validation.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/node:|React|indexedDB|\bfetch\s*\(/);
  });
});


describe('PREP-09: статус области не подменяется текстом замечания', () => {
  it('оставляет INVALID блокирующим даже при единственном WARNING', () => {
    const input = validInput();
    input.areas.DOCUMENTS = { status: 'INVALID', issues: [{ code: 'DOCUMENT_REVIEW', severity: 'WARNING', message: 'Замечание без отдельной ошибки' }] };
    const report = validateScenario(input);
    expect(report.status).toBe('ERROR');
    expect(report.issues).toContainEqual(expect.objectContaining({ area: 'DOCUMENTS', code: 'VALIDATION_AREA_INVALID', severity: 'ERROR' }));
  });
});
