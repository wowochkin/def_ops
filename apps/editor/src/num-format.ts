/** Общий формат чисел карточек: часы и километры — целые, доли — две цифры с запятой, тысячи — через пробел. */
export const fmtCount = (x: number): string => (Math.round(x) || 0).toLocaleString('ru-RU');
export const fmtHours = (h: number): string => `${fmtCount(Math.max(0, h))} ч`;
export const fmtKm = (km: number): string => `${fmtCount(km)} км`;
export const fmtFrac = (x: number): string => x.toFixed(2).replace('.', ',');
export const fmtPct = (x: number | null): string => (x == null ? '—' : `${Math.round(x * 100)} %`);
