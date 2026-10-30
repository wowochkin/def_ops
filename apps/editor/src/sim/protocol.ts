import type { MapDocument } from '@def-ops/core';
import type { AgentHistory, AgentTrace, OperationSummary, ZoneGrid } from '@def-ops/sim';
import type { ReplayUnits } from '../formation-card';
import type { KbStamp } from './kb-stamp';

export interface SimRequest {
  scenario: string; rules: string; seed: number; runs: number; toleranceKm: number;
  /** Агентная модель (дивизии; настольное приложение): ход, посчитанный ядром на Rust, и её история — карта строится здесь. */
  agents?: { trace: AgentTrace; history: AgentHistory; title: string; stepHours: number };
}

export interface SimResult {
  scenario: string; rules: string; seed: number; runs: number; ms: number;
  /** Модель расчёта: нынешняя (армии и корпуса) или агентная (дивизии). */
  engine?: 'army' | 'agents';
  /** Начало, конец сценария и длительность хода — для передачи командования с начала хода. */
  start: string; end: string; turnHours: number; scenarioName: string;
  /** Доля положений в допуске (первый прогон) и по всем прогонам. */
  within: number; n: number; medianExcessKm: number; spread: number[];
  events: {
    title: string; historical: string; simulated: string | null; days: (number | null)[];
    /** Момент события в первом прогоне (снимок после хода) и место (если событие — у пункта). */
    at: string | null; place: [number, number] | null; marker: boolean;
  }[];
  eventsHit: number; eventsTotal: number;
  report: string;
  doc: MapDocument;
  /** Сводная карта операции по этому прогону: этапы, линии фронта с датами, удары армий (без шкалы времени). */
  summary: MapDocument;
  /** Формирования и снимки первого прогона — для карточки по щелчку на знаке (в старых сохранениях нет). */
  units?: ReplayUnits;
  /** Сборка данных из базы знаний, на которой посчитан итог (null — без поправок базы; в старых сохранениях нет). */
  kb?: KbStamp | null;
  /** Зоны влияния сторон для карты: снимки через 24 ч от начала и последний (в старых сохранениях и при ошибке расчёта зон нет). */
  zones?: { side: string; frames: { time: string; grid: ZoneGrid }[] };
  /** Итоги операции (агентная модель): потери сторон по суткам, фронтам и армиям и исторические (в старых сохранениях нет). */
  operation?: OperationSummary;
}

export type SimResponse =
  | { kind: 'progress'; text: string }
  | { kind: 'done'; result: SimResult }
  | { kind: 'error'; message: string };

export interface CatalogEntry { id: string; title: string; detail: string; toleranceKm: number; rules: { id: string; title: string }[] }
