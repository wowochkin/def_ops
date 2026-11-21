import { nearestSnapshot, restoreSnapshot, snapshotStateHash } from './snapshot-restore';
import { replayClockAt } from './replay-clock';
import {
  REPLAY_FACT_TYPES,
  type ReplayArchive,
  type ReplayCursor,
  type ReplayEvent,
  type ReplayFrame,
  type ReplaySavedTrace,
  type ReplayState,
} from './types';

export { REPLAY_DOMAINS, REPLAY_FACT_TYPES } from './types';
export type {
  ReplayActor, ReplayArchive, ReplayChange, ReplayClock, ReplayCompatibility, ReplayControlPoint, ReplayCursor,
  ReplayDomain, ReplayDomains, ReplayEvent, ReplayFactType, ReplayFrame, ReplayPanel, ReplayPerspective,
  ReplayRandomKey, ReplaySavedTrace, ReplaySnapshot, ReplayState, ReplayVersionRef,
} from './types';

export type ReplayReducer = (state: ReplayState, event: ReplayEvent) => ReplayState;

function reduceRecordedTransition(state: ReplayState, event: ReplayEvent): ReplayState {
  if (state.appliedEventIds.includes(event.eventId)) throw new Error(`Событие уже применено: ${event.eventId}`);
  const domains = { ...state.domains };
  for (const change of event.changes ?? []) domains[change.domain] = structuredClone(change.value);
  return {
    domains,
    appliedEventIds: [...state.appliedEventIds, event.eventId],
    eventCauses: { ...state.eventCauses, [event.eventId]: [...(event.causeIds ?? [])] },
  };
}

export class ReplayReducerRegistry {
  private readonly reducers = new Map<number, ReplayReducer>();

  constructor() {
    this.reducers.set(1, reduceRecordedTransition);
  }

  register(version: number, reducer: ReplayReducer): void {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Некорректная версия reducer реплея');
    if (this.reducers.has(version)) throw new Error(`Reducer реплея версии ${version} уже зарегистрирован`);
    this.reducers.set(version, reducer);
  }

  find(version: number): ReplayReducer | null {
    return this.reducers.get(version) ?? null;
  }
}

export type RestoreAtInput = {
  archive: ReplayArchive;
  cursor: number | ReplayCursor;
  playbackSpeed?: number;
  reducerRegistry?: ReplayReducerRegistry;
  scheduler?: (...args: never[]) => unknown;
  languageModel?: (...args: never[]) => unknown;
  random?: (...args: never[]) => unknown;
  externalService?: (...args: never[]) => unknown;
};

function cursorParts(archive: ReplayArchive, cursor: number | ReplayCursor): { branchId: string; sequence: number } {
  const value = typeof cursor === 'number' ? { sequence: cursor } : cursor;
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new Error('Некорректный курсор реплея');
  return { branchId: typeof cursor === 'number' ? archive.branchId : cursor.branchId ?? archive.branchId, sequence: value.sequence };
}

function validateSequence(events: readonly ReplayEvent[], branchId: string, cursor: number): ReplayEvent[] {
  const selected = events.filter(event => event.branchId === branchId && event.sequence <= cursor);
  const ids = new Set<string>();
  selected.forEach((event, index) => {
    if (event.sequence !== index + 1) throw new Error(`Нарушена последовательность событий реплея: ожидалась ${index + 1}, получена ${event.sequence}`);
    if (ids.has(event.eventId)) throw new Error(`Повтор eventId в журнале: ${event.eventId}`);
    ids.add(event.eventId);
  });
  return selected;
}

function panelsFor(state: ReplayState, sequence: number): ReplayFrame['panels'] {
  return Object.fromEntries(Object.entries(state.domains).map(([domain, value]) => [domain, {
    sequence, source: 'TRUTH' as const, value: structuredClone(value),
  }]));
}

function incompatibleFrame(
  archive: ReplayArchive,
  snapshot: ReturnType<typeof nearestSnapshot>,
  cursor: number,
  playbackSpeed: number,
  events: readonly ReplayEvent[],
): ReplayFrame {
  const state = restoreSnapshot(snapshot);
  return {
    archiveId: archive.archiveId,
    branchId: snapshot.branchId,
    requestedSequence: cursor,
    sequence: snapshot.sequence,
    snapshotId: snapshot.snapshotId,
    appliedEventIds: [],
    state,
    stateHash: null,
    identityClaimed: false,
    compatibility: 'INCOMPATIBLE_READ',
    perspective: 'TRUTH',
    source: 'TRUTH',
    label: 'Истинное состояние',
    clock: replayClockAt(archive, snapshot.sequence, playbackSpeed),
    panels: panelsFor(state, snapshot.sequence),
    events,
    traces: [],
  };
}

export function restoreAt(input: RestoreAtInput): ReplayFrame {
  const { archive, reducerRegistry = new ReplayReducerRegistry(), playbackSpeed = 1 } = input;
  const { branchId, sequence } = cursorParts(archive, input.cursor);
  const events = validateSequence(archive.events, branchId, sequence);
  const snapshot = nearestSnapshot(archive, branchId, sequence);
  const initialReducer = reducerRegistry.find(snapshot.reducerVersion);
  if (!initialReducer) return incompatibleFrame(archive, snapshot, sequence, playbackSpeed, events);

  let state = restoreSnapshot(snapshot);
  const subsequent = events.filter(event => event.sequence > snapshot.sequence);
  const traces: ReplaySavedTrace[] = [];
  for (const event of subsequent) {
    const reducer = reducerRegistry.find(event.reducerVersion ?? snapshot.reducerVersion);
    if (!reducer) return incompatibleFrame(archive, snapshot, sequence, playbackSpeed, events);
    state = reducer(state, event);
    if (event.savedTrace) traces.push(structuredClone(event.savedTrace));
  }
  const stateHash = snapshotStateHash(state);
  const controlPoint = archive.controlPoints?.find(point => point.sequence === sequence);
  if (controlPoint && controlPoint.stateHash !== stateHash) throw new Error('Контрольный хеш состояния реплея не совпадает');
  return {
    archiveId: archive.archiveId,
    branchId,
    requestedSequence: sequence,
    sequence,
    snapshotId: snapshot.snapshotId,
    appliedEventIds: subsequent.map(event => event.eventId),
    state,
    stateHash,
    identityClaimed: true,
    compatibility: 'REPRODUCIBLE',
    perspective: 'TRUTH',
    source: 'TRUTH',
    label: 'Истинное состояние',
    clock: replayClockAt(archive, sequence, playbackSpeed),
    panels: panelsFor(state, sequence),
    events: events.map(event => structuredClone(event)),
    traces,
  };
}

export function replayStateHash(state: ReplayState): string {
  return snapshotStateHash(state);
}

export function journalCoverage(events: readonly Pick<ReplayEvent, 'type'>[]): string[] {
  return REPLAY_FACT_TYPES.filter(required => !events.some(event => event.type === required));
}
