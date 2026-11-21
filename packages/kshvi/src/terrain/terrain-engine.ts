import { createHash } from 'node:crypto';
import { weatherTime } from '@def-ops/core';
import { canonicalJson } from '../events/canonical';
import type {
  TerrainAdvanceInput,
  TerrainEventInput,
  TerrainHistoryEvent,
  TerrainHydrologyProfile,
  TerrainObject,
  TerrainPatch,
  TerrainState,
} from './types';

function copyObject(object: TerrainObject): TerrainObject {
  return { ...object, geometry: { ...object.geometry }, ...(object.speedKph ? { speedKph: { ...object.speedKph } } : {}) };
}

function record(objects: readonly TerrainObject[]): Record<string, TerrainObject> {
  const result: Record<string, TerrainObject> = {};
  for (const object of objects) {
    if (result[object.id]) throw new Error(`Повтор идентификатора местности ${object.id}`);
    result[object.id] = copyObject(object);
  }
  return result;
}

export function validateTerrainHydrologyProfile(profile: TerrainHydrologyProfile): string[] {
  const issues: string[] = [];
  if (!profile.id.trim()) issues.push('Нужен идентификатор профиля местности');
  for (const [name, value] of Object.entries({ version: profile.version, hydrologyVersion: profile.hydrologyVersion, graphVersion: profile.graphVersion, weatherEffectProfileVersion: profile.weatherEffectProfileVersion })) {
    if (!Number.isSafeInteger(value) || value < 1) issues.push(`Нужна положительная версия ${name}`);
  }
  if (profile.status === 'APPROVED' && !profile.approvedBy.trim()) issues.push('Нужно методическое утверждение профиля местности');
  if (!profile.requiredWeather.length) issues.push('Нужны обязательные погодные показатели');
  for (const rule of profile.rules) {
    if (!rule.id.trim()) issues.push('Правилу местности нужен идентификатор');
    if (!rule.unit.trim()) issues.push(`rule ${rule.id}: нужна единица измерения`);
    if (!Array.isArray(rule.range) || rule.range.length !== 2 || rule.range[0] >= rule.range[1]) issues.push(`rule ${rule.id}: некорректный диапазон`);
    if (rule.condition.min < rule.range[0] || rule.condition.max > rule.range[1] || rule.condition.min >= rule.condition.max) issues.push(`rule ${rule.id}: условие вне диапазона`);
    if (!rule.movementClasses.length) issues.push(`rule ${rule.id}: нужны классы движения`);
    if (rule.outside !== 'REQUIRES_REVIEW') issues.push(`rule ${rule.id}: поведение вне области должно требовать проверки`);
    if (!rule.source) issues.push(`rule ${rule.id}: нужен источник или учебное допущение`);
    else if (rule.source.kind === 'SOURCE' && (!rule.source.citation.trim() || !rule.source.applicability.trim())) issues.push(`rule ${rule.id}: источник и область применимости обязательны`);
    else if (rule.source.kind === 'ASSUMPTION' && (!rule.source.note.trim() || !rule.source.applicability.trim())) issues.push(`rule ${rule.id}: допущение и область применимости обязательны`);
  }
  return issues;
}

export function initialTerrainState(input: { operationalAt: string; objects: readonly TerrainObject[]; profile: TerrainHydrologyProfile }): TerrainState {
  weatherTime(input.operationalAt);
  const issues = validateTerrainHydrologyProfile(input.profile);
  if (issues.length || input.profile.status !== 'APPROVED') throw new Error(`Профиль местности не готов: ${[...issues, ...(input.profile.status === 'APPROVED' ? [] : ['Профиль не утверждён'])].join('; ')}`);
  const objects = record(input.objects);
  const initialObjects = record(input.objects);
  const queues: Record<string, TerrainState['queues'][string]> = {};
  for (const object of input.objects) {
    if (['BRIDGE', 'FORD', 'FERRY', 'PONTOON', 'ICE_CROSSING'].includes(object.kind)) queues[object.id] = { crossingId: object.id, reservations: [] };
  }
  return {
    schemaVersion: 1,
    operationalAt: input.operationalAt,
    revision: 0,
    status: 'READY',
    unknown: [],
    objects,
    initialObjects,
    history: [],
    queues,
    algorithmVersions: { H_v: input.profile.hydrologyVersion, G_v: input.profile.graphVersion },
    profileId: input.profile.id,
    profileVersion: input.profile.version,
    weatherEffectProfileVersion: input.profile.weatherEffectProfileVersion,
  };
}

function patched(object: TerrainObject, patch: TerrainPatch, operationalAt: string, source: string): TerrainObject {
  return {
    ...object,
    ...patch,
    ...(patch.speedKph ? { speedKph: { ...object.speedKph, ...patch.speedKph } } : {}),
    dataAt: operationalAt,
    source: `${source}; ${object.source}`,
  };
}

function changed(before: TerrainObject, after: TerrainObject): boolean {
  return canonicalJson(before) !== canonicalJson(after);
}

function applyEvent(state: TerrainState, event: TerrainEventInput): TerrainState {
  const before = state.objects[event.objectId];
  if (!before) throw new Error(`Объект местности не найден: ${event.objectId}`);
  if (!event.reason.trim()) throw new Error('Событию местности нужна причина');
  weatherTime(event.operationalAt);
  const after = patched(before, event.patch, event.operationalAt, `Событие ${event.id}`);
  if (!changed(before, after)) return state;
  const historyEvent: TerrainHistoryEvent = { ...event, before, after };
  return {
    ...state,
    revision: state.revision + 1,
    objects: { ...state.objects, [event.objectId]: after },
    history: [...state.history, historyEvent],
  };
}

function contains(min: number, max: number, upper: number, value: number): boolean {
  return value >= min && (value < max || value === max && value === upper);
}

/** Версионный H_v: погода превращается в события мира, а не в незаметную правку карты. */
export function advanceTerrain(state: TerrainState, input: TerrainAdvanceInput): TerrainState {
  const targetMs = weatherTime(input.operationalAt);
  const currentMs = weatherTime(state.operationalAt);
  if (targetMs < currentMs) throw new Error('Нельзя переписать прошлое оперативное время местности');
  if (state.profileId !== input.profile.id || state.profileVersion !== input.profile.version || state.algorithmVersions.H_v !== input.profile.hydrologyVersion || state.algorithmVersions.G_v !== input.profile.graphVersion) {
    throw new Error('Версия профиля не совпадает с версией TerrainState');
  }
  const knownIds = new Set(state.history.map(event => event.id));
  const events = (input.events ?? []).filter(event => !knownIds.has(event.id));
  const weatherApplied = input.weather ? state.history.some(event => event.causeIds.includes(input.weather!.eventId)) : true;
  if (!events.length && weatherApplied) return targetMs === currentMs ? state : { ...state, operationalAt: input.operationalAt };

  if (input.weather && !weatherApplied) {
    const missing = input.profile.requiredWeather.filter(field => input.weather!.state[field] === null || input.weather!.state[field] === undefined);
    if (missing.length) return { ...state, operationalAt: input.operationalAt, status: 'REQUIRES_REVIEW', unknown: missing };
    const outside = input.profile.rules.filter(rule => {
      const value = input.weather!.state[rule.input];
      return value !== undefined && value !== null && (value < rule.range[0] || value > rule.range[1]);
    }).map(rule => rule.input);
    if (outside.length) return { ...state, operationalAt: input.operationalAt, status: 'REQUIRES_REVIEW', unknown: [...new Set(outside)] };
  }

  let next: TerrainState = { ...state, status: 'READY', unknown: [] };
  if (input.weather && !weatherApplied) {
    for (const rule of input.profile.rules) {
      const value = input.weather.state[rule.input];
      if (value === null || value === undefined || !contains(rule.condition.min, rule.condition.max, rule.range[1], value)) continue;
      for (const object of Object.values(next.objects)) {
        if (object.kind !== rule.kind) continue;
        const id = `weather-${createHash('sha256').update(canonicalJson({ eventId: input.weather.eventId, ruleId: rule.id, objectId: object.id, operationalAt: input.operationalAt })).digest('hex').slice(0, 32)}`;
        if (knownIds.has(id)) continue;
        next = applyEvent(next, {
          id, type: 'terrain.weather.v1', objectId: object.id, operationalAt: input.operationalAt,
          geometry: object.geometry, reason: rule.reason, causeIds: [input.weather.eventId], visibility: 'PUBLIC', patch: rule.set,
        });
      }
    }
  }
  for (const event of events) {
    const eventMs = weatherTime(event.operationalAt);
    if (eventMs < currentMs || eventMs > targetMs) throw new Error('Событие местности вне обрабатываемого интервала оперативного времени');
    next = applyEvent(next, event);
  }
  return { ...next, operationalAt: input.operationalAt };
}

export function projectTerrainState(state: TerrainState, visibility: { sideId: string; observedEventIds: readonly string[] }): {
  sideId: string;
  operationalAt: string;
  quality: 'CURRENT' | 'STALE';
  objects: Record<string, TerrainObject>;
  history: TerrainEventInput[];
} {
  const observed = new Set(visibility.observedEventIds);
  const visible = (event: TerrainEventInput) => event.visibility === 'PUBLIC' || observed.has(event.id);
  const objects = record(Object.values(state.initialObjects));
  for (const event of state.history) {
    if (!visible(event)) continue;
    objects[event.objectId] = patched(objects[event.objectId], event.patch, event.operationalAt, `Событие ${event.id}`);
  }
  const hidden = state.history.some(event => !visible(event));
  return {
    sideId: visibility.sideId,
    operationalAt: state.operationalAt,
    quality: hidden ? 'STALE' : 'CURRENT',
    objects,
    history: state.history.filter(visible).map(({ id, type, objectId, operationalAt, geometry, reason, causeIds, visibility: access, patch }) => ({ id, type, objectId, operationalAt, geometry, reason, causeIds, visibility: access, patch })),
  };
}
