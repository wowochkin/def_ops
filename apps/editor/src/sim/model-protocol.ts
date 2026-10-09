import type { CalibParams, OperationPackage, Rules, RulesEvaluation } from '@def-ops/sim';

export interface ModelRequest {
  id: number;
  scenario: string;
  /** Операция пакетом (ещё не сохранена). */
  pkg?: OperationPackage;
  /** Правила: id (встроенные или свои) или целиком. */
  rules: string | Rules;
  /** Множители калибровки поверх правил. */
  params?: CalibParams;
  seeds: number;
  seed0?: number;
  trainUntil?: string;
  toleranceKm?: number;
}
export type ModelResponse = { id: number; ok: true; result: RulesEvaluation } | { id: number; ok: false; error: string };
