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

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function offsetMinutes(offset: string): number {
  if (offset === 'Z') return 0;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) throw new Error('Некорректное смещение ISO 8601');
  const total = hours * 60 + minutes;
  return offset.startsWith('-') ? -total : total;
}

function instant(value: string): { milliseconds: number; offset: string; minutes: number } {
  if (typeof value !== 'string') throw new Error('Некорректное время ISO 8601');
  const match = ISO_WITH_OFFSET.exec(value);
  if (!match) throw new Error('Время должно быть в ISO 8601 с явным UTC Z или смещением');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new Error('Некорректная календарная дата');
  if (hour > 23 || minute > 59 || second > 59) throw new Error('Некорректное календарное время');
  const minutes = offsetMinutes(offset);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Некорректное время ISO 8601');
  return { milliseconds, offset, minutes };
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function zoneOffset(milliseconds: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(milliseconds));
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const represented = new Date(0);
  represented.setUTCFullYear(values.year, values.month - 1, values.day);
  represented.setUTCHours(values.hour, values.minute, values.second, 0);
  return Math.round((represented.getTime() - Math.floor(milliseconds / 1000) * 1000) / 60_000);
}

export function wallClockAt(value: string): WallClockAt {
  return new Date(instant(value).milliseconds).toISOString() as WallClockAt;
}

export function operationalAt(value: string, zone: string): OperationalTime {
  if (typeof zone !== 'string' || !zone.trim()) throw new Error('Для оперативного времени нужна зона');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
  } catch {
    throw new Error('Некорректная IANA-зона оперативного времени');
  }
  const parsed = instant(value);
  const actualOffset = zoneOffset(parsed.milliseconds, zone);
  if (actualOffset !== parsed.minutes) {
    throw new Error(`Смещение не соответствует IANA-зоне: ожидалось ${formatOffset(actualOffset)}`);
  }
  return Object.freeze({
    normalizedAt: new Date(parsed.milliseconds).toISOString() as ISODateTime,
    originalAt: value,
    zone,
    offset: parsed.offset === 'Z' ? '+00:00' : parsed.offset,
  });
}
