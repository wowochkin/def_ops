import type { ISODateTime, OperationalTime, Quantity, WallClockAt } from './types';

export function knownQuantity(value: number, unit: string): Quantity {
  if (!Number.isFinite(value)) throw new Error('Величина должна быть конечным числом');
  if (!unit.trim()) throw new Error('Для величины нужна единица измерения');
  return Object.freeze({ value, unit, status: 'KNOWN' });
}

export function unknownQuantity(unit: string): Quantity {
  if (!unit.trim()) throw new Error('Для неизвестной величины нужна единица измерения');
  return Object.freeze({ value: null, unit, status: 'UNKNOWN' });
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Некорректное время ISO 8601');
  return parsed;
}

export function wallClockAt(value: string): WallClockAt {
  return new Date(instant(value)).toISOString() as WallClockAt;
}

export function operationalAt(value: string, zone: string): OperationalTime {
  if (!zone.trim()) throw new Error('Для оперативного времени нужна зона');
  const normalizedAt = new Date(instant(value)).toISOString() as ISODateTime;
  const match = value.match(/(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error('Оперативное время должно содержать смещение или Z');
  return Object.freeze({
    normalizedAt,
    originalAt: value,
    zone,
    offset: match[1] === 'Z' ? '+00:00' : match[1],
  });
}
