/**
 * Смысловой поиск: векторы (эмбеддинги) записей и частей документов от модели Qwen3-Embedding,
 * запущенной в LM Studio рядом с основной моделью (/v1/embeddings). Поиск гибридный: BM25 по основам слов
 * и близость векторов сливаются по рангам (RRF); нет модели эмбеддингов — работает один BM25.
 *
 * Как устроена Qwen3-Embedding (по карточке модели): вектор — состояние последнего токена (pooling last),
 * нормированный; запросу предшествует однострочная инструкция «Instruct: …\nQuery:…» (по-английски —
 * так обучалась), документы — без инструкции; длину вектора можно урезать (MRL: первые N чисел) — LM Studio
 * параметр dimensions не соблюдает, урезаем здесь. В llama.cpp к тексту добавляют <|endoftext|> (по нему
 * берётся последний токен); нужно ли это на конкретном сервере, решает самопроверка.
 */
import type { Entry } from './schema';
import { category } from './schema';
import type { Hit } from './search';

/** Инструкция к запросу (одно предложение о задаче поиска). */
export const QUERY_INSTRUCT = 'Given a question or topic about Soviet and German military operations of 1945 (Vistula–Oder, Berlin), retrieve knowledge base passages that answer it';
export const EOS = '<|endoftext|>';

export interface EmbedOptions {
  /** Длина вектора (MRL); 0 — как отдаёт модель. */
  dims: number;
  /** Добавлять <|endoftext|> к тексту. */
  eos: boolean;
}

export const queryText = (q: string, o: EmbedOptions) => `Instruct: ${QUERY_INSTRUCT}\nQuery:${q}${o.eos ? EOS : ''}`;
export const docText = (t: string, o: EmbedOptions) => `${t}${o.eos ? EOS : ''}`;

/** Текст записи для вектора: название, синонимы, описание, факты, начала разделов (до ~1500 знаков). */
export function entryEmbedText(e: Entry): string {
  const c = category(e.category);
  const facts = (e.facts ?? []).slice(0, 12).map((f) => `${c?.fields.find((x) => x.key === f.key)?.title ?? f.key}: ${f.value}`);
  const secs = (e.sections ?? []).slice(0, 3).map((s) => `${s.title}. ${s.text.slice(0, 300)}`);
  return [`${e.title}${e.aliases?.length ? ` (${e.aliases.filter((a) => !/^[a-z]+_/.test(a)).join(', ')})` : ''} — ${c?.title ?? ''}`, e.summary, ...facts, ...secs].filter(Boolean).join('\n').slice(0, 1500);
}

/** Вектор из ответа модели: урезать до dims (MRL) и нормировать. */
export function toVec(v: number[], dims: number): Float32Array {
  const n = dims > 0 ? Math.min(dims, v.length) : v.length;
  const out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) { out[i] = v[i]; s += v[i] * v[i]; }
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Короткий хеш текста (FNV-1a) — ключ кэша векторов: изменился текст — вектор пересчитывается. */
export function hashText(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36) + t.length.toString(36);
}

/** Ближайшие по косинусу (векторы нормированы — это скалярное произведение). */
export function nearest(q: Float32Array, vectors: Map<string, Float32Array>, limit = 50, filter?: (id: string) => boolean): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = [];
  for (const [id, v] of vectors) if (!filter || filter(id)) out.push({ id, score: dot(q, v) });
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Слияние выдач по рангам (Reciprocal Rank Fusion): score = Σ 1/(k + rank). Устойчиво к разным шкалам
 * BM25 и косинуса; документ, найденный обоими способами, поднимается выше.
 */
export function rrf(lists: { id: string }[][], k = 60): { id: string; score: number }[] {
  const m = new Map<string, number>();
  for (const l of lists) l.forEach((x, i) => m.set(x.id, (m.get(x.id) ?? 0) + 1 / (k + i + 1)));
  return [...m].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/** Гибридная выдача: BM25 + векторы → Hit[] (doc — найти документ индекса по id). */
export function hybridHits(bm25: Hit[], vec: { id: string; score: number }[], doc: (id: string) => Hit | undefined, limit: number): Hit[] {
  const byId = new Map(bm25.map((h) => [h.id, h]));
  return rrf([bm25, vec]).slice(0, limit).map((x) => { const h = byId.get(x.id) ?? doc(x.id); return h ? { ...h, score: +x.score.toFixed(4) } : null; }).filter((h): h is Hit => !!h);
}

/**
 * Самопроверка модели эмбеддингов: перефразировка должна быть ближе, чем посторонний текст. Неверный пулинг
 * (не last) или чужая модель дают векторы «правильной длины и неправильного смысла» — это ловится здесь.
 * Возвращает зазор (близость перефразировки минус близость постороннего) — ниже 0,05 считаем неисправностью.
 */
export const SELF_TEST = {
  query: 'Почему наступление на Зееловских высотах затянулось?',
  close: 'Прорыв обороны 9-й армии на Зееловских высотах шёл медленно: танковые армии были введены в бой до прорыва главной полосы.',
  far: 'Рецепт борща: свёкла, капуста, картофель, сметана; варить полтора часа.',
};
export function selfTestGap(q: Float32Array, close: Float32Array, far: Float32Array): number {
  return +(dot(q, close) - dot(q, far)).toFixed(3);
}
