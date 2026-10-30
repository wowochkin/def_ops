/** Общий формат чисел карточек: часы и километры — целые, доли — две цифры с запятой, тысячи — через пробел. */
export const fmtCount = (x: number): string => (Math.round(x) || 0).toLocaleString('ru-RU');
export const fmtHours = (h: number): string => `${fmtCount(Math.max(0, h))} ч`;
export const fmtKm = (km: number): string => `${fmtCount(km)} км`;
export const fmtFrac = (x: number): string => x.toFixed(2).replace('.', ',');
export const fmtPct = (x: number | null): string => (x == null ? '—' : `${Math.round(x * 100)} %`);
/**
 * Укомплектованность двумя мерилами: «42 % от штата, 97 % от начала операции»; штата нет — только от начала операции.
 */
export const manningText = (u: { manning?: number | null; strength: number }): string =>
  u.manning != null ? `${fmtPct(u.manning)} от штата, ${fmtPct(u.strength)} от начала операции` : `${fmtPct(u.strength)} от начала операции`;
