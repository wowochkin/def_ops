import { describe, expect, it } from 'vitest';
import { addInitialMapMarker, createInitialSituationMap } from '../src/scenario/initial-map';
import { emptyPreparationDraft, validatePreparationDraft, type ScenarioForce } from '../src/scenario/preparation-draft';

const at = '2030-01-01T06:00:00Z';
const draft = {
  schemaVersion: 1, environmentSnapshotId: null, initialMap: null, initialMapStatus: 'DRAFT',
  forces: [], equipment: [], formation: null, logistics: null, autonomy: null, readinessStage: null, readinessStates: [],
  updatedAt: at,
};
const map = createInitialSituationMap({
  id: 'map-1', revision: 1, environment: { snapshotId: 'environment-1', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
  initialOperationalAt: at, timeZone: 'UTC', weatherFrameRef: 'weather-1', terrainStateRef: 'terrain-1',
  symbolSet: { id: 'symbols', revision: 1, sha256: 'b'.repeat(64) }, attribution: ['Источник'],
});
const force: ScenarioForce = {
  id: 'force-1',
  identity: { sideId: 'side-1', nodeId: 'node-1', type: 'Соединение', organizationalLevel: 'FORMATION', service: 'GROUND', parentId: null },
  composition: { personnel: [], units: [], equipment: [] },
  state: { deployed: false, readiness: null, serviceability: null, initialCapability: null, fatigue: null, training: null, moralePsych: null },
  position: {
    geometry: { status: 'UNKNOWN', reason: 'Не определено' }, area: { status: 'UNKNOWN', reason: 'Не определено' },
    formation: { status: 'UNKNOWN', reason: 'Не определено' }, route: { status: 'UNKNOWN', reason: 'Не определено' },
    movement: { status: 'UNKNOWN', reason: 'Не определено' }, task: { status: 'UNKNOWN', reason: 'Не определено' },
  },
  supply: { stocks: [], capacities: [], consumptionNorms: [], nodeIds: [], routeIds: [] },
  capabilities: { actions: [], environmentLimits: [], reconnaissance: null, communications: null, interaction: null },
  uncertainty: { knownByNodeId: 'node-1', reportedAt: at, accuracy: null, completeness: null },
  source: { sourceId: 'source-1', reportedAt: at },
};
const mapped = addInitialMapMarker(map, {
  id: 'marker-1', revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
  geometry: { type: 'Point', coordinates: [0.2, 0.2] }, sourceId: 'source-1', authorId: 'author', eventId: 'event',
  validFrom: at, validUntil: '2030-01-02T06:00:00Z', state: 'OBSERVED', confidence: 0.8,
  uncertainty: { radiusM: 10, note: '' }, visibility: { staffOnly: true }, links: { forceId: 'force-1' },
  sideId: 'side-1', symbol: { id: 'symbol', version: 'v1', sideId: 'side-1', status: 'APPROVED', sourceDocument: 'source', sourcePage: 1 },
});

describe('версия черновика подготовки', () => {
  it('создаёт и проверяет пустой черновик с неизвестными исходными данными', () => {
    expect(emptyPreparationDraft(at)).toEqual(draft);
    expect(validatePreparationDraft(draft)).toEqual(draft);
  });

  it.each([
    ['неизвестная версия', { schemaVersion: 2 }, /версия/i],
    ['неизвестный статус', { schemaVersion: 1, initialMapStatus: 'READY' }, /статус/i],
    ['лишнее поле', { ...draft, approved: true }, /approved/],
    ['неверное время изменения', { ...draft, updatedAt: 'позже' }, /updatedAt/],
    ['неполная структура сил', { ...draft, forces: [{ id: 'force-1' }] }, /forces/],
    ['неверный вложенный тип', { ...draft, forces: [{ ...force, state: { ...force.state, deployed: 'false' } }] }, /deployed/],
    ['лишнее вложенное поле', { ...draft, forces: [{ ...force, identity: { ...force.identity, sealed: true } }] }, /sealed/],
    ['дубликат силы', { ...draft, forces: [force, force] }, /force-1/],
    ['пустая карта со статусом нанесения', { ...draft, environmentSnapshotId: 'environment-1', initialMap: map, initialMapStatus: 'MAPPED' }, /нанесён/i],
    ['снимок не соответствует карте', { ...draft, environmentSnapshotId: 'environment-2', initialMap: map }, /снимок/i],
    ['несуществующая сила в отметке', { ...draft, environmentSnapshotId: 'environment-1', initialMap: mapped, initialMapStatus: 'MAPPED' }, /force-1/],
    ['неизвестная отметка в связях', { ...draft, environmentSnapshotId: 'environment-1', forces: [force], initialMap: { ...mapped, markers: [{ ...mapped.markers[0], links: { linkedMarkerIds: ['missing-marker'] } }] } }, /missing-marker/],
    ['поле геометрии другого типа', { ...draft, environmentSnapshotId: 'environment-1', forces: [force], initialMap: { ...mapped, markers: [{ ...mapped.markers[0], geometry: { type: 'Point', coordinates: [[0, 0], [1, 1]] } }] } }, /geometry/],
  ])('отклоняет несовместимые данные — %s', (_name, value, message) => {
    expect(() => validatePreparationDraft(value)).toThrow(message);
  });

  it('проверяет нанесённую карту с существующей силой и тем же снимком', () => {
    const value = { ...draft, environmentSnapshotId: 'environment-1', initialMap: mapped, initialMapStatus: 'MAPPED', forces: [force] };
    expect(validatePreparationDraft(value)).toEqual(value);
  });
});

describe('ссылки состояния готовности', () => {
  const stage = {
    id: 'stage-1', title: 'Готовность', startsAt: at, dueAt: at,
    signal: { id: 'signal-1', sentAt: at, senderNodeId: 'node-1' },
    activities: [{
      id: 'activity-1', kind: 'SIGNAL', title: 'Сигнал', responsibleNodeId: 'node-1', startAt: at, dueAt: at,
      durationMinutes: 0, dependsOn: [], requiresSignal: false, preconditions: [], resources: [], reportRequired: false,
      criterion: { id: 'criterion-1', description: '' },
    }],
    completionCriterionIds: ['criterion-1'], adverseOutcomes: ['FAILED'],
  };
  const state = {
    subjectKind: 'FORCE', subjectId: 'force-1', initialLevel: null, requiredLevel: null, status: 'IN_PROGRESS',
    completedActivityIds: ['activity-1'], signalReceipt: { signalId: 'signal-1', receivedAt: at },
    activityRecords: [{ activityId: 'activity-1', status: 'COMPLETED', startedAt: at, completedAt: at, reportId: null }],
    reports: [], criterionResults: {}, limitations: [], authorizations: [], history: [],
  };

  it.each([
    { completedActivityIds: ['orphan'] },
    { activityRecords: [{ ...state.activityRecords[0], activityId: 'orphan' }] },
    { signalReceipt: { signalId: 'orphan', receivedAt: at } },
  ])('отклоняет активную ссылку на данные вне этапа %#', patch => {
    expect(() => validatePreparationDraft({
      ...draft, forces: [force], readinessStage: stage, readinessStates: [{ ...state, ...patch }],
    })).toThrow(/orphan/);
  });

  it('отклоняет активное выполнение при отсутствии этапа', () => {
    expect(() => validatePreparationDraft({ ...draft, forces: [force], readinessStates: [state] })).toThrow(/этап/);
  });

  it('сохраняет подтверждённые ссылки этапа и историю с идентификаторами прежнего этапа', () => {
    const history = [{ id: 'old-event', at, kind: 'ACTIVITY_COMPLETED', causeId: 'prior-activity', details: 'Предыдущий этап' }];
    const reports = [{ id: 'report', activityId: 'prior-activity', authorId: 'author', submittedAt: at, text: 'Предыдущий этап' }];
    const value = { ...draft, forces: [force], readinessStage: stage, readinessStates: [{ ...state, history, reports }] };
    expect(validatePreparationDraft(value)).toEqual(value);
  });
});
