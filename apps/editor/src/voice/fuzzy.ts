/**
 * Общее для нестрогого сравнения вслух сказанного: нормализация, расстояние Левенштейна, допуск на ошибку.
 * Без зависимостей — годится и разбору команд, и поиску мест и соединений.
 */

/** Нижний регистр, без знаков препинания (дефис — пробел), «ё» → «е», пробелы сжаты. */
export const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Расстояние Левенштейна между словами. */
export function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Допуск на ошибку распознавания: короткие слова — только точно, длинные — до двух правок. */
export const tolerance = (len: number) => (len <= 4 ? 0 : len <= 7 ? 1 : 2);
