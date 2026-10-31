/**
 * Рекорд дня среди посетителей стенда: самый быстрый ход операции и самые малые потери против истории за местные
 * сутки. Хранится в `localStorage` стенда (общем для всех его окон), по ключу дня; пишет главное окно по итогу сеанса.
 */
import { axisNote, type AxesDetail } from './score';
import type { FrontId } from './settings';

export interface DayRecord {
  speed?: { days: number; front: FrontId };
  cost?: { ratio: number; front: FrontId };
}
const KEY = 'def_ops.expo.record';
const today = () => new Date().toLocaleDateString('sv-SE');

export function readRecord(day = today()): DayRecord {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, DayRecord>;
    return all[day] ?? {};
  } catch {
    return {};
  }
}

/** Учесть завершённый сеанс; возвращает рекорд дня после него. */
export function noteSession(a: AxesDetail, front: FrontId, day = today()): DayRecord {
  const r = readRecord(day);
  if (a.days !== null && (!r.speed || a.days < r.speed.days)) r.speed = { days: a.days, front };
  if (a.lossRatio !== null && (!r.cost || a.lossRatio < r.cost.ratio)) r.cost = { ratio: a.lossRatio, front };
  try {
    localStorage.setItem(KEY, JSON.stringify({ [day]: r }));
  } catch {
    /* хранилище недоступно — рекорд только в этом сеансе */
  }
  return r;
}

/** Строки рекорда дня для итога: «быстрее истории на 2,0 сут», «потери меньше истории на 18 %». */
export function recordLines(r: DayRecord): { speed: string | null; cost: string | null } {
  const base = { speed: 0, cost: 0, intent: 0, done: 0, due: 0 };
  return {
    speed: r.speed ? axisNote('speed', { ...base, days: r.speed.days, lossRatio: null }) : null,
    cost: r.cost ? axisNote('cost', { ...base, days: null, lossRatio: r.cost.ratio }) : null,
  };
}
