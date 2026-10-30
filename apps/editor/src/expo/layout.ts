/**
 * Раскладки выставочных экранов 3/2/1 и сцены по фазам сеанса.
 *
 * Окна нумеруются слева направо. Три экрана: ИИ — карта — ход операции; два: карта — ИИ и ход; один: всё на карте.
 * Подключено меньше мониторов, чем задано, — раскладка берётся по числу подключённых; фаза сеанса от этого не меняется:
 * виды пересобирают раскладку из того же состояния режиссёра.
 */
import type { Role } from './settings';
import type { Phase } from './director';

export type Slot = { window: number; roles: Role[] };

export function layoutFor(count: 1 | 2 | 3): Slot[] {
  if (count === 3) return [{ window: 0, roles: ['ai'] }, { window: 1, roles: ['map'] }, { window: 2, roles: ['progress'] }];
  if (count === 2) return [{ window: 0, roles: ['map'] }, { window: 1, roles: ['ai', 'progress'] }];
  return [{ window: 0, roles: ['map', 'ai', 'progress'] }];
}

/** Сколько окон открыть: не больше подключённых мониторов, не меньше одного. */
export function effectiveCount(wanted: 1 | 2 | 3, monitors: number): 1 | 2 | 3 {
  const n = Math.max(1, Math.min(wanted, Math.floor(monitors) || 0));
  return n as 1 | 2 | 3;
}

/** Сцена: общая на все экраны (панорама, карта во всю ширину, итог) или каждый экран показывает свою роль. */
export type Scene = 'panorama' | 'map-wide' | 'roles' | 'result-wide' | 'startup';

export function sceneOf(phase: Phase): Scene {
  switch (phase.kind) {
    case 'attract':
    case 'welcome':
      return 'panorama';
    case 'briefing':
      return 'map-wide';
    case 'turn':
      return 'roles';
    case 'result':
      return 'result-wide';
    case 'startup':
      return 'startup';
  }
}

/** Доля ширины общей сцены, которую показывает окно: равные части слева направо. */
export function panoramaPart(window: number, count: number): { from: number; to: number } {
  const n = Math.max(1, count);
  return { from: window / n, to: window === n - 1 ? 1 : (window + 1) / n };
}
