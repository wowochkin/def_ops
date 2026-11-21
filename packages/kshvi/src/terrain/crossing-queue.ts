import { weatherTime } from '@def-ops/core';
import type { CrossingReservation, MovementClass, TerrainObject, TerrainState } from './types';

export type CrossingDecision = 'ALLOWED' | 'BLOCKED' | 'REQUIRES_REVIEW';

export function crossingDecision(
  vehicle: { loadTonnes: number | null; movementClass?: MovementClass; widthM?: number | null; heightM?: number | null },
  crossing: Pick<TerrainObject, 'capacityTonnes' | 'status'> & Partial<TerrainObject>,
): CrossingDecision {
  if (crossing.status !== 'OPEN' || crossing.deployed === false || crossing.equipmentStatus === 'DAMAGED') return 'BLOCKED';
  if (vehicle.loadTonnes === null || crossing.capacityTonnes === null || crossing.capacityTonnes === undefined) return 'REQUIRES_REVIEW';
  if (!Number.isFinite(vehicle.loadTonnes) || vehicle.loadTonnes < 0 || !Number.isFinite(crossing.capacityTonnes)) return 'REQUIRES_REVIEW';
  if (vehicle.widthM === null || vehicle.heightM === null || crossing.widthM === null || crossing.heightM === null) return 'REQUIRES_REVIEW';
  if (vehicle.loadTonnes > crossing.capacityTonnes) return 'BLOCKED';
  if (vehicle.widthM !== undefined && crossing.widthM !== undefined && vehicle.widthM > crossing.widthM) return 'BLOCKED';
  if (vehicle.heightM !== undefined && crossing.heightM !== undefined && vehicle.heightM > crossing.heightM) return 'BLOCKED';
  return 'ALLOWED';
}

export type CrossingReservationRequest = Readonly<{
  id: string;
  crossingId: string;
  columnId: string;
  movementClass: MovementClass;
  loadTonnes: number;
  arrivalAt: string;
  durationMinutes: number;
}>;

export type CrossingReservationResult = Readonly<{
  status: 'RESERVED' | 'QUEUED' | 'BLOCKED' | 'REQUIRES_REVIEW';
  state: TerrainState;
  reservation: CrossingReservation | null;
}>;

const iso = (milliseconds: number) => new Date(milliseconds).toISOString();

/** Ёмкость одновременного прохождения и занятые интервалы; повтор request.id не создаёт дубль. */
export function reserveCrossing(state: TerrainState, request: CrossingReservationRequest): CrossingReservationResult {
  const queue = state.queues[request.crossingId] ?? { crossingId: request.crossingId, reservations: [] };
  const duplicate = queue.reservations.find(value => value.id === request.id);
  if (duplicate) return { status: duplicate.startAt === duplicate.arrivalAt ? 'RESERVED' : 'QUEUED', state, reservation: duplicate };
  const crossing = state.objects[request.crossingId];
  if (!crossing) throw new Error(`Переправа не найдена: ${request.crossingId}`);
  const decision = crossingDecision(request, crossing);
  if (decision !== 'ALLOWED') return { status: decision === 'BLOCKED' ? 'BLOCKED' : 'REQUIRES_REVIEW', state, reservation: null };
  if (!Number.isFinite(request.durationMinutes) || request.durationMinutes <= 0) return { status: 'REQUIRES_REVIEW', state, reservation: null };
  const capacity = crossing.simultaneousCapacity ?? 1;
  if (!Number.isSafeInteger(capacity) || capacity < 1) return { status: 'REQUIRES_REVIEW', state, reservation: null };
  const arrivalMs = weatherTime(request.arrivalAt);
  const durationMs = request.durationMinutes * 60000;
  let startMs = arrivalMs;
  const sorted = [...queue.reservations].sort((a, b) => a.startAt.localeCompare(b.startAt));
  for (;;) {
    const overlapping = sorted.filter(value => Date.parse(value.startAt) < startMs + durationMs && Date.parse(value.endAt) > startMs);
    if (overlapping.length < capacity) break;
    startMs = Math.min(...overlapping.map(value => Date.parse(value.endAt)));
  }
  const reservation: CrossingReservation = {
    ...request,
    startAt: iso(startMs),
    endAt: iso(startMs + durationMs),
  };
  const next: TerrainState = {
    ...state,
    revision: state.revision + 1,
    queues: {
      ...state.queues,
      [request.crossingId]: { crossingId: request.crossingId, reservations: [...sorted, reservation].sort((a, b) => a.startAt.localeCompare(b.startAt)) },
    },
  };
  return { status: startMs === arrivalMs ? 'RESERVED' : 'QUEUED', state: next, reservation };
}
