/**
 * Показ на одном мониторе экрана многомониторной раскладки: «Все вместе» — раскладка на один экран, иначе — окно
 * `window` раскладки на `count` экранов во весь монитор. Переключают шапка, стрелки ←/→ и меню оператора
 * (событие окна `expo-lens`); сеанс от этого не меняется.
 */
export type Lens = { count: 2 | 3; window: number } | null;
export const LENS_EVENT = 'expo-lens';

/** Кнопки шапки: «Все вместе», 1, 2, 3 — экраны раскладки на три. */
export const LENSES: { label: string; lens: Lens }[] = [
  { label: 'Все вместе', lens: null },
  { label: '1', lens: { count: 3, window: 0 } },
  { label: '2', lens: { count: 3, window: 1 } },
  { label: '3', lens: { count: 3, window: 2 } },
];

/** Те же кнопки для раскладки на два. */
export const LENSES_2: { label: string; lens: Lens }[] = [
  { label: 'Все вместе', lens: null },
  { label: '1', lens: { count: 2, window: 0 } },
  { label: '2', lens: { count: 2, window: 1 } },
];

/** Кнопки шапки для текущего показа: раскладка на два — пока выбран её экран. */
export const lensesFor = (cur: Lens) => (cur?.count === 2 ? LENSES_2 : LENSES);

export const sameLens = (a: Lens, b: Lens) => (a === null || b === null ? a === b : a.count === b.count && a.window === b.window);

/** Следующая (или предыдущая) кнопка шапки по кругу. */
export function stepLens(cur: Lens, d: 1 | -1): Lens {
  const list = lensesFor(cur);
  const i = Math.max(0, list.findIndex((x) => sameLens(x.lens, cur)));
  return list[(i + d + list.length) % list.length].lens;
}

export function setLens(lens: Lens) {
  dispatchEvent(new CustomEvent<Lens>(LENS_EVENT, { detail: lens }));
}
