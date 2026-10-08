import type { MapDocument } from '@def-ops/core';

export interface SimRequest { scenario: string; rules: string; seed: number; runs: number; toleranceKm: number }

export interface SimResult {
  scenario: string; rules: string; seed: number; runs: number; ms: number;
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
}

export type SimResponse =
  | { kind: 'progress'; text: string }
  | { kind: 'done'; result: SimResult }
  | { kind: 'error'; message: string };

export interface CatalogEntry { id: string; title: string; detail: string; toleranceKm: number; rules: { id: string; title: string }[] }
