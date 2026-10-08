/**
 * Вопросы и рассказы по материалам базы: поиск подбирает записи и части документов, модель отвечает
 * только по ним и ссылается на них номерами [n]. Того, чего в материалах нет, — не придумывает.
 */
import { category, type Entry } from './schema';
import { snippet, type Hit, type Index } from './search';

export interface Source { n: number; kind: 'entry' | 'chunk'; ref: string; title: string; text: string }

/** Материалы для ответа: n лучших совпадений (записи — описание и ключевые факты; документы — отрывок). */
export function gather(index: Index, byId: Map<string, Entry>, query: string, opts: { limit?: number; pool?: number; filter?: (e: Entry | null, h: Hit) => boolean; hits?: Hit[] } = {}): Source[] {
  // hits — готовая выдача (гибридный поиск); иначе — BM25
  const hits = opts.hits ?? index.search(query, { limit: opts.pool ?? (opts.limit ?? 8) * 2 });
  const out: Source[] = [];
  for (const h of hits) {
    const e = h.kind === 'entry' ? byId.get(h.ref) ?? null : null;
    if (opts.filter && !opts.filter(e, h)) continue;
    const text = e
      ? [e.summary, ...(e.facts ?? []).slice(0, 14).map((f) => `${category(e.category)?.fields.find((x) => x.key === f.key)?.title ?? f.key}: ${f.value}${f.reliability ? ` [${f.reliability}]` : ''}`), ...(e.sections ?? []).slice(0, 2).map((s) => `${s.title}: ${snippet(s.text, query, 500)}`)].join('\n')
      : snippet(h.text, query, 900);
    out.push({ n: out.length + 1, kind: h.kind, ref: h.ref, title: e ? `${e.title} (${category(e.category)?.title})` : h.title, text });
    if (out.length >= (opts.limit ?? 8)) break;
  }
  return out;
}

const block = (src: Source[]) => src.map((s) => `[${s.n}] ${s.title}\n${s.text}`).join('\n\n');

export function qaMessages(mode: 'ask' | 'lecture', question: string, src: Source[], history: { q: string; a: string }[] = []) {
  const system = `Вы — преподаватель военной истории и знаток операций 1945 года. Отвечаете по-русски, по материалам базы знаний, которые даны ниже под номерами.

Строгие правила:
1. Опирайтесь только на материалы. Каждое утверждение — со ссылкой на номер материала в квадратных скобках: [1], [2].
2. Чего в материалах нет — так и скажите («в базе знаний об этом нет сведений») и не дополняйте по памяти.
3. Где источники расходятся или помечены как оценка (C), — укажите это.
4. Названия — по-русски, оригинал — в скобках при первом упоминании.`;
  const task = mode === 'lecture'
    ? `Расскажите по теме «${question}»: связный рассказ для обучения (400–800 слов) — обстановка и замысел, силы сторон, ход событий, итоги и значение; по разделам с заголовками; со ссылками [n].`
    : `Вопрос: ${question}\nОтветьте по существу, коротко (до 250 слов, если вопрос не требует большего), со ссылками [n].`;
  return [
    { role: 'system' as const, content: system },
    ...history.slice(-3).flatMap((h) => [{ role: 'user' as const, content: h.q }, { role: 'assistant' as const, content: h.a }]),
    { role: 'user' as const, content: `Материалы базы знаний:\n\n${block(src) || '(по запросу ничего не найдено)'}\n\n${task}` },
  ];
}

/**
 * Справка из базы для модели в игре: в обычных вопросах — только доктрина и техника (не ход боёв и не описания
 * местности с историческими позициями: это история, а не обстановка); в вопросах истории — и они, с пометкой «история».
 * Устройство модели и список источников не включаются: правила арбитра советник получает отдельно.
 */
export function gameReference(index: Index, byId: Map<string, Entry>, query: string, historyAllowed: boolean, limit = 5, hits?: Hit[]): string {
  const src = gather(index, byId, query, { limit, pool: 400, hits, filter: (e) => !!e && e.group !== 'model' && e.category !== 'sources' && (historyAllowed || !!category(e.category)?.gameSafe) });
  if (!src.length) return '';
  return src.map((s) => `- [База знаний${historyAllowed && !category(byId.get(s.ref)?.category ?? 'sources')?.gameSafe ? ', история' : ''}: ${s.title}] ${s.text.replace(/\n/g, '; ').slice(0, 700)}`).join('\n');
}
