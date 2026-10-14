/**
 * Кандидат-факт: единая форма всего, что может попасть в базу знаний (из текста, скана, таблицы, пакета
 * внешнего агента или ручной правки). Проходит проверки (checks.ts), по итогам — в базу, в очередь или в отбой.
 */
import type { Claim, Reliability } from './schema';

export type Origin = 'text' | 'scan' | 'table' | 'agent' | 'manual';

export type Evidence =
  | { kind: 'quote'; doc: string; chunk: number; quote: string }
  | { kind: 'scan'; doc: string; page: number; quote: string; box?: [number, number, number, number] }  // доли страницы
  /** cell — столбец, из которого факт (дни в столбцах); dayCells — все столбцы-дни строки: числа сверяются только с ячейкой факта. */
  | { kind: 'row'; doc: string; row: number; cells: Record<string, string>; cell?: string; dayCells?: string[] }
  | { kind: 'agent'; ref: string; quote?: string }     // шифр, ссылка на карточку документа, выписка
  | { kind: 'manual'; note?: string };

export type CheckId = 'quote' | 'numbers' | 'subject' | 'place' | 'date' | 'plausible' | 'duplicate' | 'cross';
export type CheckResult = { check: CheckId; level: 'ok' | 'doubt' | 'fail'; why?: string };

export interface Candidate {
  id: string;
  /** Виды части 1; subject — id, если сопоставлено, иначе ''. */
  claim: Claim;
  /** Как в источнике (для сопоставления). */
  names: { subject?: string; parent?: string; place?: string; between?: [string, string] };
  key: string;
  value: string;
  source: string;
  pages?: string;
  reliability?: Reliability;
  origin: Origin;
  evidence: Evidence;
  /** Операция, к которой относится документ. */
  op?: string;
  checks: CheckResult[];
  verdict: 'auto' | 'review' | 'drop';
  /** Для очереди. */
  state: 'pending' | 'accepted' | 'rejected';
  /** Ключ встроенного факта (entry#index + отпечаток), если это исправление. */
  corrects?: string;
}
