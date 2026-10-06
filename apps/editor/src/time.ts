/**
 * Моменты времени в редакторе: показ в московском и местном времени, ввод в
 * выбранном поясе. Хранится всегда UTC (см. core/temporal).
 */
import { createContext, useContext } from 'react';
import tzlookup from '@photostructure/tz-lookup';
import {
  MOSCOW_TZ, fromZoned, isDateOnly, isTime, offsetLabel, toTime, toZoned, zoneOffset,
  type LngLat, type TimeInstant,
} from '@def-ops/core';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const pad = (n: number) => String(n).padStart(2, '0');

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

/** В каком времени вводятся моменты. */
export type InputZone = 'msk' | 'local' | 'utc';

export interface Zones {
  /** Пояс местного времени (IANA). */
  local: string;
  /** Пояс местного времени задан для карты вручную (иначе — по месту на карте). */
  localFixed: boolean;
  input: InputZone;
  setInput: (z: InputZone) => void;
}

export const ZonesContext = createContext<Zones>({ local: MOSCOW_TZ, localFixed: false, input: 'msk', setInput: () => undefined });
export const useZones = () => useContext(ZonesContext);

/** Пояс по координатам (современные границы поясов, исторические правила смещения). */
export function zoneAt(ll: LngLat): string {
  try { return tzlookup(ll[1], ll[0]); } catch { return MOSCOW_TZ; }
}

/** Пояс, в котором вводится время. */
export function inputZoneId(z: Zones): string {
  return z.input === 'msk' ? MOSCOW_TZ : z.input === 'local' ? z.local : 'UTC';
}

/** Момент из миллисекунд (UTC): полночь — только дата, иначе дата и время до минут. */
export function fromMs(ms: number): TimeInstant {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return d.getUTCHours() || d.getUTCMinutes() ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

const ZONE_NAMES: Record<string, string> = {
  'Europe/Moscow': 'Москва', 'Europe/Berlin': 'Берлин', 'Europe/Warsaw': 'Варшава', 'Europe/Kyiv': 'Киев', 'Europe/Kiev': 'Киев',
  'Europe/Minsk': 'Минск', 'Europe/Riga': 'Рига', 'Europe/Vilnius': 'Вильнюс', 'Europe/Tallinn': 'Таллин', 'Europe/Kaliningrad': 'Калининград',
  'Europe/Budapest': 'Будапешт', 'Europe/Vienna': 'Вена', 'Europe/Prague': 'Прага', 'Europe/Bucharest': 'Бухарест', 'Europe/Sofia': 'София',
  'Europe/Belgrade': 'Белград', 'Europe/Helsinki': 'Хельсинки', 'Europe/Volgograd': 'Сталинград (Волгоград)', 'Europe/Simferopol': 'Симферополь',
  'Europe/Samara': 'Самара', 'Asia/Vladivostok': 'Владивосток', 'Asia/Shanghai': 'Маньчжурия (Шанхай)', 'Asia/Harbin': 'Харбин', 'Asia/Tokyo': 'Токио',
  'Asia/Yekaterinburg': 'Свердловск (Екатеринбург)', 'UTC': 'UTC',
};
/** Пояса для выбора «местного» вручную. */
export const ZONE_CHOICES = Object.keys(ZONE_NAMES).filter((z) => z !== 'Europe/Kiev' && z !== 'UTC');

export const zoneName = (z: string) => ZONE_NAMES[z] ?? z.split('/').pop()!.replace(/_/g, ' ');

/** «UTC+2» для пояса на момент. */
export function zoneOffsetLabel(t: TimeInstant, zone: string): string {
  return offsetLabel(zoneOffset(toTime(t), zone));
}

function dateText(local: string, short: boolean): string {
  const [y, m, d] = local.slice(0, 10).split('-').map(Number);
  return short ? `${d}.${pad(m)}.${y}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Момент для показа. Дата без времени суток — только дата. Иначе — московское
 * время, а если задан пояс местного времени и он отличается — и местное:
 * «25 апреля 1945, 06:00 мск (05:00 местн.)».
 */
export function fmtMoment(t: TimeInstant | null | undefined, short = false, local?: string | null): string {
  if (!t || !isTime(t)) return '—';
  if (isDateOnly(t)) return dateText(t, short);
  const msk = toZoned(t, MOSCOW_TZ);
  let s = `${dateText(msk, short)}, ${msk.slice(11, 16)} мск`;
  if (local && local !== MOSCOW_TZ) {
    const loc = toZoned(t, local);
    if (loc !== msk) s += ` (${loc.slice(0, 10) !== msk.slice(0, 10) ? dateText(loc, true) + ' ' : ''}${loc.slice(11, 16)} местн.)`;
  }
  return s;
}

/** Время суток в поясе: «06:00». */
export function clock(t: TimeInstant, zone: string): string {
  return toZoned(t, zone).slice(11, 16);
}

/** Значение для <input type="datetime-local"> в поясе ввода и обратно. */
export function toInput(t: TimeInstant | null | undefined, zone: string = MOSCOW_TZ): string {
  if (!t || !isTime(t)) return '';
  return toZoned(t, zone);
}
export function fromInput(v: string, zone: string = MOSCOW_TZ): TimeInstant | null {
  if (!v || !isTime(v)) return null;
  return fromZoned(v, zone);
}
