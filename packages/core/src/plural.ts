/** Склонение существительного после числа (русский): 1 объект, 2 объекта, 5 объектов; 11–14 — «много». */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = Math.abs(n) % 10, h = Math.abs(n) % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

/** Число с разрядами и слово в нужной форме: «94 373 объекта». */
export const countRu = (n: number, one: string, few: string, many: string): string =>
  `${n.toLocaleString('ru-RU')} ${plural(n, one, few, many)}`;
