/**
 * Группировка базы по операциям: запись относится к операции явно (operations — из разбора документов операции,
 * scenario — связь с переигровкой) или по периоду и рубрикам (Висло-Одерская — 1.1, Берлинская — 1.2).
 * Записи без операции — общие (доктрина, техника, формирования вне разбора).
 */
import type { Entry } from './schema';

/** Операция для группировки: id и сроки (как у сценария). */
export interface KbOperation { id: string; title: string; start: string; end: string }

/** Сроки исторических операций по рубрикам. */
const RUBRIC_PERIOD: [string, string, string][] = [['1.1', '1945-01-12', '1945-02-03'], ['1.2', '1945-04-16', '1945-05-08']];
const CHRONO: Record<string, [string, string]> = { vistula: ['1945-01-12', '1945-02-03'], berlin: ['1945-04-16', '1945-05-08'] };
const overlaps = (a0: string, a1: string, b0: string, b1: string) => a0.slice(0, 10) <= b1.slice(0, 10) && b0.slice(0, 10) <= a1.slice(0, 10);

/** К каким операциям из списка относится запись. */
export function entryOperations(e: Entry, ops: KbOperation[]): string[] {
  const own = [...(e.operations ?? []), ...(e.scenario ? [e.scenario] : [])];
  // запись из документа операции — только её операции; остальные — ещё и по периоду и рубрикам
  if (e.origin === 'document' && own.length) return [...new Set(own)];
  const periods: [string, string][] = [];
  for (const c of e.rubrics ?? []) { const p = RUBRIC_PERIOD.find(([r]) => c === r || c.startsWith(`${r}.`)); if (p) periods.push([p[1], p[2]]); }
  if (e.category === 'chronology' && e.group && CHRONO[e.group]) periods.push(CHRONO[e.group]);
  if (e.period?.from && (e.category === 'chronology' || e.category === 'battles' || e.category === 'operations')) periods.push([e.period.from, e.period.to ?? e.period.from]);
  const inferred = ops.filter((o) => periods.some(([a, b]) => overlaps(a, b, o.start, o.end))).map((o) => o.id);
  return [...new Set([...own, ...inferred])];
}

/** Запись видна в разделе операции op ('' — все, 'general' — только общие). */
export function inOperation(e: Entry, op: string, ops: KbOperation[]): boolean {
  if (!op) return true;
  const list = entryOperations(e, ops);
  return op === 'general' ? !list.length : list.includes(op);
}

/** Запись из документа другой операции — разбор документов операции op её не дополняет (своя запись). */
export const foreignTo = (e: Entry, op?: string) => !!op && e.origin === 'document' && !!e.operations?.length && !e.operations.includes(op);
