import type { LngLat, MapDocument } from '@def-ops/core';
import type { GameRecord, IntelReport, Order, UnitReport } from '@def-ops/sim';
import type { AiTurn } from '@def-ops/staff-service/live';

export type Thinking = 'off' | 'low' | 'medium' | 'high';

/** Связь с моделью (LM Studio) — хранится в браузере, общая для разделов. */
export interface LlmSettings {
  /** Адрес API: по умолчанию — через сервер разработки (/llm → LM Studio на этом компьютере). */
  url: string;
  /** Модель; пусто — первая загруженная. */
  model: string;
  thinking: Thinking;
}

/** Противник: штаб на модели или «без штаба» — держится прежних приказов (для пробы без LM Studio). */
export type EnemyMode = 'llm' | 'passive';

export interface GameStart {
  scenario: string;
  rules: string;
  seed: number;
  /** Момент передачи командования (начало хода). */
  takeover: string;
}

export type GameRequest =
  | { kind: 'start'; start: GameStart; record?: GameRecord; llm: LlmSettings; enemy: EnemyMode }
  /** Конец хода человека: его приказы (issuedAt — начало хода). */
  | { kind: 'turn'; orders: Order[] }
  | { kind: 'settings'; llm: LlmSettings; enemy: EnemyMode }
  | { kind: 'retry-ai' }
  /** Ход без новых приказов противника (модель не ответила). */
  | { kind: 'skip-ai' }
  /** Посредник: показать на карте всех (без тумана войны). */
  | { kind: 'reveal'; on: boolean };

export interface Place { id: string; title: string; at: LngLat }

export interface JournalDay {
  /** Начало хода. */
  time: string;
  /** Наши приказы этого хода — словами. */
  orders: string[];
  /** Что произошло за ход (донесения). */
  events: string[];
}

export interface Goal { title: string; historical: string; simulated: string | null; days: number | null; at: string | null; place: LngLat | null }

export interface TurnView {
  scenario: string; scenarioName: string; rules: string; seed: number;
  start: string; end: string; takeover: string; time: string; turnHours: number;
  /** Ход игры (с передачи командования) и всего ходов в игре. */
  turn: number; turns: number;
  over: boolean;
  human: { id: string; name: string };
  ai: { id: string; name: string };
  /** Объединения верхнего уровня (фронты) — для группировки докладов. */
  groups: { id: string; name: string }[];
  own: UnitReport[];
  intel: IntelReport[];
  /** Донесения за прошедший ход. */
  events: string[];
  places: Place[];
  /** Задержка доведения приказов по ступеням, часов. */
  delays: Record<string, number>;
  detectKm: number;
  goals: Goal[];
  journal: JournalDay[];
  doc: MapDocument;
}

export type AiStatus =
  | { state: 'off' }
  | { state: 'thinking'; time: string; since: number }
  | { state: 'done'; time: string; turn: AiTurn }
  | { state: 'error'; time: string; error: string; turn?: AiTurn };

export type GameResponse =
  | { kind: 'progress'; text: string }
  | { kind: 'view'; view: TurnView }
  | { kind: 'ai'; status: AiStatus }
  /** Поток ответа модели (для посредника), кусками. */
  | { kind: 'ai-stream'; text: string; reset?: boolean }
  /** Ход ждёт решения посредника: модель не ответила. */
  | { kind: 'blocked'; error: string }
  | { kind: 'record'; record: GameRecord }
  | { kind: 'error'; message: string };
