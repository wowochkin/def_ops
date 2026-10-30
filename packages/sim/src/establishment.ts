/**
 * Штатная численность соединений по виду (kind сценария агентной модели) — мерило укомплектованности «от штата».
 * Таблица — data/rules/establishment.json: только числа с источником из базы знаний; вида без строки нет — null.
 */
import table from '../data/rules/establishment.json';

export interface EstablishmentRow { id: string; side: string; kinds: string[]; personnel: number; title: string; kb: string; source: string; reliability: string; note?: string }

export const ESTABLISHMENT: EstablishmentRow[] = (table as { rows: EstablishmentRow[] }).rows;

/** Штат соединения стороны по виду; вида нет или штата для него нет — null. */
export function establishmentOf(side: string, kind: string | undefined): { personnel: number; title: string; source: string } | null {
  if (!kind) return null;
  const r = ESTABLISHMENT.find((x) => x.side === side && x.kinds.includes(kind));
  return r ? { personnel: r.personnel, title: r.title, source: r.source } : null;
}

/** Строка штата по id (для нормативов). */
export const establishmentRow = (id: string): EstablishmentRow | undefined => ESTABLISHMENT.find((x) => x.id === id);
