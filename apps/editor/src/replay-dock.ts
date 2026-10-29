/** Плеер и колонка у левого края карты переигровки: скорости, память раскрытости графика состязания. */

/** Скорости проигрывания, часов операции в секунду. */
export const PLAYER_SPEEDS: readonly number[] = [1, 3, 6, 12, 24, 48];

/** Ключ памяти: раскрыт ли график состязания. */
export const CHART_KEY = 'def_ops.replay.chart';

/** Раскрыто ли: «open»/«closed» из хранилища, иначе умолчание; ошибка доступа — умолчание. */
export function readOpen(key: string, dflt: boolean, store?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const v = store?.getItem(key);
    return v === 'open' ? true : v === 'closed' ? false : dflt;
  } catch { return dflt; }
}
