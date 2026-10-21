/**
 * Допроверка названия пункта, когда точное сопоставление и сопоставление по основам не нашли его: модель пишет
 * название с опечаткой, на другом языке («Кюстрн», «Зеелов», «Seelov», «город Кюстрин», «Мюнхеберг (Müncheberg)»
 * без скобок). Сравнение по звучанию (свёртка букв) с расстоянием правок; берётся только однозначный ближайший —
 * похожие названия соседних пунктов («Нойдамм» и «Нойдорф») не склеиваются.
 */

const NOISE = /^(?:город|гор|г|пгт|посёлок|поселок|пос|деревня|дер|д|село|с|станция|ст|район[а-я]*|р-н|населённый пункт|населенный пункт|нп|город-крепость|крепость|мост|у|в|к|на|до|от|около|южнее|севернее|восточнее|западнее)\.?\s+/i;

/** Латиница: диакритика и немецкие/польские буквы → простые («Müncheberg» → «muencheberg», «Łeknica» → «leknica»). */
const LATIN: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', ł: 'l', ś: 's', ź: 'z', ż: 'z', ć: 'c', ń: 'n', ó: 'o', ą: 'a', ę: 'e' };

/** Свёртка названия: регистр, «ё», шум, повторы букв, близкие по звуку буквы. */
export function fold(s: string): string {
  let x = s.toLowerCase().replace(/\([^()]*\)/g, ' ').replace(/[«»"'„“”.,;:]/g, ' ').replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && NOISE.test(x); i++) x = x.replace(NOISE, '');
  x = x.replace(/[äöüßłśźżćńóąę]/g, (c) => LATIN[c] ?? c);
  return x.replace(/ё/g, 'е').replace(/э/g, 'е').replace(/й/g, 'и').replace(/ы/g, 'и').replace(/ю/g, 'у').replace(/я/g, 'а')
    .replace(/[ьъ]/g, '').replace(/(.)\1+/g, '$1').replace(/\s+/g, '');
}

/** Оригинальное название в скобках, свёрнутое («Зелов (Seelow)» → «selow»). */
function foldOriginal(s: string): string {
  const m = /\(([^()]*)\)\s*$/.exec(s);
  return m ? fold(m[1]) : '';
}

/** Расстояние Дамерау — Левенштейна (вставка, удаление, замена, перестановка соседних). */
export function distance(a: string, b: string): number {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
  for (let j = 1; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[n][m];
}

/** Сколько правок допустимо для названия такой длины (короткие названия — только точно). */
const allowed = (len: number): number => (len >= 9 ? 2 : len >= 5 ? 1 : 0);

export interface Ranked { i: number; d: number }

/** Все пункты по близости названия: меньше расстояние — ближе; без порога (для подсказки модели). */
export function rankAreas(name: string, titles: string[]): Ranked[] {
  const q = fold(name);
  if (!q) return [];
  return titles.map((t, i) => {
    const f = fold(t), o = foldOriginal(t);
    const d = Math.min(distance(q, f), o ? distance(q, o) : Infinity);
    return { i, d };
  }).sort((a, b) => a.d - b.d || a.i - b.i);
}

/**
 * Однозначный пункт, похожий на название: расстояние в пределах допуска, и следующий по близости — не ближе чем
 * на одну правку дальше. Иначе −1: решать — модели (повторный запрос с ближайшими пунктами).
 */
export function fuzzyIndex(name: string, titles: string[]): number {
  const q = fold(name);
  if (q.length < 5) return -1;
  const r = rankAreas(name, titles);
  if (!r.length || r[0].d > allowed(q.length)) return -1;
  if (r.length > 1 && r[1].d - r[0].d < 1) return -1;
  return r[0].i;
}

/** Ближайшие пункты по написанию (для подсказки модели): не больше k, расстояние не больше четверти длины названия + 1. */
export function nearestTitles(name: string, titles: string[], k = 3): string[] {
  const q = fold(name);
  if (!q) return [];
  return rankAreas(name, titles).filter((r) => r.d <= Math.ceil(q.length / 4) + 1).slice(0, k).map((r) => titles[r.i]);
}
