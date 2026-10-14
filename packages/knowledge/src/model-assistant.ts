/**
 * Ассистент модели: поиск по выжимке (model-index.ts) в два хода — разделы описания и нормативы, затем код
 * (функции, упомянутые в найденных разделах, и найденные по вопросу); запрос к модели; дозапрос по точному имени.
 */
import { Index } from './search';
import type { Entry } from './schema';
import type { ModelFragment } from './model-index';

export const ASSIST_LIMITS = { docs: 6, code: 6, chars: 24_000, need: 4, history: 3 } as const;

export interface ModelIx { index: Index; byId: Map<string, ModelFragment>; all: ModelFragment[] }

/** Короткое имя для поиска: у кода — имя функции (и тип, и метод у Rust), у раздела — номер, у норматива — id. */
function aliasesOf(f: ModelFragment): string[] {
  if (f.kind === 'code') return [f.title, ...f.title.split('::'), f.place.split(':')[0].split('/').pop()!];
  if (f.kind === 'doc') return [f.place.replace(/^раздел /, '')];
  return [f.place];
}

export function modelIndex(frags: ModelFragment[]): ModelIx {
  const pseudo = frags.map((f) => ({ id: f.id, category: 'model', title: f.title, summary: f.text, aliases: aliasesOf(f), facts: [], relations: [] }) as unknown as Entry);
  return { index: new Index(pseudo), byId: new Map(frags.map((f) => [f.id, f])), all: frags };
}

const codeName = (f: ModelFragment) => f.title.split('::').pop()!;
const fileOf = (f: ModelFragment) => f.place.split(':')[0].split('/').pop()!;

/** Фрагменты кода по имени из `refs`: функция/тип (в том числе метод Тип::имя) или файл (лучшие по вопросу). */
function codeByRef(ix: ModelIx, ref: string, question: string): ModelFragment[] {
  const name = ref.split('.').pop()!;
  if (/\.(ts|rs)$/.test(ref)) {
    const inFile = new Set(ix.all.filter((f) => f.kind === 'code' && fileOf(f) === ref).map((f) => `e:${f.id}`));
    if (!inFile.size) return [];
    return ix.index.search(question, { limit: 2, filter: (d) => inFile.has(d.id) }).map((h) => ix.byId.get(h.ref)!).filter(Boolean);
  }
  return ix.all.filter((f) => f.kind === 'code' && (f.title === ref || codeName(f) === name));
}

/** Два хода: разделы и нормативы по вопросу, затем код — по ссылкам найденного и по вопросу; общий объём ограничен. */
export function findFragments(ix: ModelIx, question: string, o: { limit?: number } = {}): ModelFragment[] {
  const kind = (k: ModelFragment['kind'][]) => (d: { ref: string }) => k.includes(ix.byId.get(d.ref)?.kind as ModelFragment['kind']);
  const docs = ix.index.search(question, { limit: o.limit ?? ASSIST_LIMITS.docs, filter: kind(['doc', 'norm']) }).map((h) => ix.byId.get(h.ref)!);
  const code: ModelFragment[] = [];
  const add = (f: ModelFragment) => { if (code.length < ASSIST_LIMITS.code && !code.some((x) => x.id === f.id)) code.push(f); };
  for (const d of docs) for (const r of d.refs ?? []) for (const f of codeByRef(ix, r, question)) add(f);
  for (const h of ix.index.search(question, { limit: ASSIST_LIMITS.code * 2, filter: kind(['code']) })) add(ix.byId.get(h.ref)!);
  // объём: сначала разделы, затем код, пока помещается
  const out: ModelFragment[] = [];
  let chars = 0;
  for (const f of [...docs, ...code]) {
    if (chars + f.text.length > ASSIST_LIMITS.chars) continue;
    out.push(f);
    chars += f.text.length;
  }
  return out;
}

/** Дозапрос по точному имени: функция (или Тип::метод), раздел («22.3»), норматив (id); не больше 4. */
export function byName(ix: ModelIx, names: string[]): ModelFragment[] {
  const out: ModelFragment[] = [];
  for (const raw of names) {
    const n = raw.trim().replace(/^раздел\s+/i, '').replace(/^norm:/, '').replace(/\(\)$/, '');
    if (!n) continue;
    const hit = ix.all.filter((f) =>
      (f.kind === 'code' && (f.title === n || codeName(f) === n))
      || (f.kind === 'doc' && f.place === `раздел ${n}`)
      || (f.kind === 'norm' && f.place === n));
    for (const f of hit) if (out.length < ASSIST_LIMITS.need && !out.some((x) => x.id === f.id)) out.push(f);
  }
  return out;
}

const KIND_RU: Record<ModelFragment['kind'], string> = { doc: 'описание', norm: 'норматив', code: 'код' };
export const fragmentBlock = (frags: ModelFragment[], from = 1): string =>
  frags.map((f, i) => `[${from + i}] ${KIND_RU[f.kind]} · ${f.place} · ${f.title}\n${f.text}`).join('\n\n');

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

/** Запрос модели: правила ответа, фрагменты под номерами, последние пары разговора. */
export function assistantMessages(question: string, frags: ModelFragment[], history: { q: string; a: string }[] = [], o: { final?: boolean } = {}): Msg[] {
  const system = `Вы — разработчик и знаток модели переигровки операций (арбитр нынешней модели и агентная модель дивизий). Отвечаете по-русски на технические вопросы об устройстве модели по фрагментам ниже: разделы описания, нормативы и исходный код.

Правила:
1. Опирайтесь только на фрагменты. Каждое утверждение — со ссылкой на номер фрагмента: [1], [2].
2. Формулы пишите простой записью (сила = численность × K_вооружения × …) и поясняйте каждый множитель и его значение, если оно есть во фрагментах (норматив, константа в коде).
3. Где описание и код расходятся — скажите, что считает код.
4. Если во фрагментах ответа нет — так и скажите, не дополняйте по памяти.
5. Сразу к делу; Markdown: «## » для разделов, списки «- », код и имена — в \`обратных кавычках\`.${o.final ? '' : `

Если для ответа не хватает конкретной функции, раздела или норматива, которые названы во фрагментах, ответ может состоять из одной строки: «НУЖНО: имя[, имя]» (функция, номер раздела вроде 19.2 или id норматива, не больше четырёх) — их добавят, и вы ответите окончательно. Просить можно один раз.`}`;
  return [
    { role: 'system', content: system },
    ...history.slice(-ASSIST_LIMITS.history).flatMap((h) => [{ role: 'user' as const, content: h.q }, { role: 'assistant' as const, content: h.a }]),
    { role: 'user', content: `Фрагменты:\n\n${fragmentBlock(frags) || '(по вопросу ничего не найдено)'}\n\nВопрос: ${question}` },
  ];
}

/** Строка дозапроса «НУЖНО: a, b» в начале ответа → имена; иначе null. */
export function parseNeed(text: string): string[] | null {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const m = /^\*{0,2}НУЖНО\*{0,2}\s*:\s*\*{0,2}\s*(.+)$/i.exec(first);
  if (!m) return null;
  const names = m[1].split(/[,;]/).map((s) => s.trim().replace(/^[`«"]+|[`»".]+$/g, '')).filter(Boolean);
  return names.length ? names : null;
}
