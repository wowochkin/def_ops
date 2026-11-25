import type { PreparationDraft, ScenarioForce } from '@def-ops/kshvi/preparation-draft';
import type { JsonValue } from '../../../../../../packages/kshvi/src/model/types';
import { createMoralePsychState } from '../../../../../../packages/kshvi/src/forces/morale-state';
import { MORALE_COMPONENT_NAMES, type MoraleComponents, type MoralePsychState } from '../../../../../../packages/kshvi/src/forces/morale-model';

const unknown = (reason: string) => ({ status: 'UNKNOWN' as const, reason });

export function initialMoralePsych(forceId: string, at: string): MoralePsychState {
  return createMoralePsychState({
    subject: { kind: 'SIMULATED_FORCE', forceId }, at,
    components: Object.fromEntries(MORALE_COMPONENT_NAMES.map(name => [name, {
      status: 'UNKNOWN', reason: 'Фактический доклад о состоянии ещё не внесён', observedAt: at,
    }])) as MoraleComponents,
  });
}

export function createScenarioForce(at: string, id: string = crypto.randomUUID()): ScenarioForce {
  return {
    id,
    identity: { sideId: '', nodeId: '', type: 'Новая сила', organizationalLevel: 'UNIT', service: 'COMBINED_ARMS', parentId: null },
    composition: { personnel: [], units: [], equipment: [] },
    state: {
      deployed: false, readiness: 0, serviceability: unknown('Ведомость исправности не заполнена'),
      initialCapability: {}, fatigue: 0, training: 0, moralePsych: initialMoralePsych(id, at) as unknown as JsonValue,
    },
    position: {
      geometry: unknown('Позиция на карте не выбрана'), area: unknown('Район не выбран'), formation: unknown('Построение не назначено'),
      route: unknown('Маршрут не назначен'), movement: unknown('Движение не начато'), task: unknown('Задача не поставлена'),
    },
    supply: { stocks: [], capacities: [], consumptionNorms: [], nodeIds: [], routeIds: [] },
    capabilities: { actions: [], environmentLimits: [], reconnaissance: {}, communications: {}, interaction: {} },
    uncertainty: { knownByNodeId: 'UNASSIGNED', reportedAt: at, accuracy: null, completeness: null },
    source: { sourceId: 'manual-scenario-entry', reportedAt: at },
  };
}

export function upsertForce(draft: PreparationDraft, force: ScenarioForce): PreparationDraft {
  const index = draft.forces.findIndex(item => item.id === force.id);
  const forces = index < 0 ? [...draft.forces, force] : draft.forces.map((item, itemIndex) => itemIndex === index ? force : item);
  return { ...draft, forces, initialMapStatus: draft.initialMap ? 'DRAFT' : draft.initialMapStatus };
}

export function forceTask(force: ScenarioForce): { title: string; markerId?: string } {
  if (force.position.task.status === 'UNKNOWN') return { title: '' };
  const value = force.position.task.value;
  if (typeof value === 'string') return { title: value };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { title: typeof value.title === 'string' ? value.title : '', markerId: typeof value.markerId === 'string' ? value.markerId : undefined };
  }
  return { title: '' };
}

export function bindForceToMapMarker(draft: PreparationDraft, force: ScenarioForce, markerId: string): PreparationDraft {
  const map = draft.initialMap;
  if (!map) throw new Error('Сначала подготовьте исходную карту');
  const marker = map.markers.find(item => item.id === markerId);
  if (!marker) throw new Error('Выбранный объект не найден на исходной карте');
  if (!marker.geometry) throw new Error('У выбранного объекта нет геометрии');
  const task = forceTask(force);
  const bound: ScenarioForce = {
    ...force,
    position: {
      ...force.position,
      geometry: { status: 'KNOWN', value: marker.geometry as unknown as JsonValue },
      ...(marker.kind === 'AREA' || marker.kind === 'BOUNDARY' ? { area: { status: 'KNOWN' as const, value: marker.id } } : {}),
      task: { status: 'KNOWN', value: { title: task.title, markerId } },
    },
    supply: {
      ...force.supply,
      routeIds: marker.kind === 'ROUTE' ? [...new Set([...force.supply.routeIds, marker.id])] : force.supply.routeIds,
    },
  };
  const next = upsertForce(draft, bound);
  return {
    ...next,
    initialMapStatus: 'DRAFT',
    initialMap: {
      ...map,
      markers: map.markers.map(item => item.id === markerId ? { ...item, links: { ...item.links, forceId: force.id } } : item),
    },
  };
}

export function removeForce(draft: PreparationDraft, forceId: string): PreparationDraft {
  const equipment = draft.equipment.filter(item => item.forceId === forceId).map(item => item.id);
  const formation = draft.formation
    ? [...draft.formation.echelons, ...draft.formation.reserves, ...draft.formation.supportGroups, ...draft.formation.columns]
      .filter(item => item.forceIds.includes(forceId)).map(item => item.id)
    : [];
  const markers = draft.initialMap?.markers.filter(item => item.links.forceId === forceId).map(item => item.id) ?? [];
  const readiness = draft.readinessStates.filter(item => item.subjectKind === 'FORCE' && item.subjectId === forceId).map(item => item.subjectId);
  const related = [
    ...equipment.map(id => `техника ${id}`), ...formation.map(id => `построение ${id}`),
    ...markers.map(id => `объект карты ${id}`), ...readiness.map(id => `готовность ${id}`),
  ];
  if (related.length) throw new Error(`Сначала удалите или переназначьте связанные записи: ${related.join(', ')}`);
  return { ...draft, forces: draft.forces.filter(item => item.id !== forceId) };
}
