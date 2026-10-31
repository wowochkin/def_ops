/**
 * ИИ выставочного сеанса: карточка по «Сгенерировать альтернативу», ответ на вопрос, комментарий выбора.
 *
 * Посетитель ИИ не ждёт: у каждой работы срок (`within`); не успела или сломалась — берётся заготовка, сеанс идёт
 * дальше. Карточки перелома модель составляет заранее (`prefetch` при раздаче), по кнопке обычно берётся уже готовая.
 * Карточка ИИ проходит ту же проверку формы, что банк; не прошла — отбрасывается. У каждого текста — источник.
 */
import type { Card, OrderKind, TurnN } from './bank';
import { LINES, answerFor, pick, textErrors, type Lines, type Vars } from './lines';

/** Запрос к языковой модели: системный текст и запрос → ответ. */
export type Ask = (system: string, text: string, signal: AbortSignal) => Promise<string>;

export type Source = 'now' | 'prepared' | 'kb' | 'bank' | 'historical' | 'aiBank';
export const SOURCE_LABEL: Record<Source, string> = {
  now: 'составлено ИИ сейчас',
  prepared: 'из подготовленных ответов',
  kb: 'ИИ, по базе знаний',
  bank: 'вариант из банка',
  aiBank: 'вариант, подготовленный ИИ',
  historical: 'исторический вариант',
};
export interface Said { text: string; source: Source }

/** Результат работы или null, если не уложилась в срок или упала; по сроку работа отменяется. */
export async function within<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      f(ac.signal).catch(() => null),
      new Promise<null>((r) => (timer = setTimeout(() => { ac.abort(); r(null); }, ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM =
  'Ты — офицер штаба на выставке о Берлинской операции 1945 года. Тон — сдержанная штабная хроника. ' +
  'Отвечай по-русски, коротко (1–2 предложения, до 200 знаков), без выдумок: только то, что дано в запросе или общеизвестно.';

export interface CardContext {
  front: string;
  frontName: string;
  marshal: string;
  n: TurnN;
  turnTitle: string;
  situation: string;
  armies: string[];
  places: string[];
  shownTitles: string[];
}

/** Первый объект JSON в тексте ответа. */
export function firstJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

export function cardPrompt(c: CardContext): string {
  return [
    `${c.frontName}, командующий — маршал ${c.marshal}. Перелом ${c.n}: ${c.turnTitle}. ${c.situation}`,
    `Составь ещё один вариант решения, не похожий на эти: ${c.shownTitles.map((t) => `«${t}»`).join(', ')}.`,
    `Армии фронта (только они): ${c.armies.join(', ')}. Объекты театра (только они): ${c.places.join(', ')}.`,
    'Распоряжения: attack, move, withdraw — с объектом; defend, hold — объект или null.',
    'Ответ — только JSON: {"title": "до 60 знаков", "lines": ["4–5 строк до 60 знаков: замысел, силы, риск, расчёт"],',
    '"orders": [{"army": "id армии", "kind": "attack", "place": "id объекта"}]}',
  ].join('\n');
}

/** Карточка из ответа модели или null, если ответ не по форме. */
export function parseCard(reply: string, c: CardContext, id: string, check: (card: Card) => string[]): Card | null {
  const j = firstJson(reply) as { title?: unknown; lines?: unknown; orders?: unknown } | null;
  if (!j || typeof j.title !== 'string' || !Array.isArray(j.lines) || !Array.isArray(j.orders)) return null;
  const card: Card = {
    id,
    front: c.front as Card['front'],
    turn: c.n,
    title: j.title.trim(),
    lines: j.lines.map((l) => String(l).trim()),
    orders: (j.orders as { army?: unknown; kind?: unknown; place?: unknown }[]).map((o) => ({
      army: String(o.army ?? ''),
      kind: String(o.kind ?? '') as OrderKind,
      place: o.place === null || o.place === undefined ? null : String(o.place),
    })),
    basis: { assumption: 'Составлено ИИ во время сеанса, проверено по форме' },
  };
  if (c.shownTitles.some((t) => t.toLowerCase() === card.title.toLowerCase())) return null;
  return check(card).length || [card.title, ...card.lines].some((t) => textErrors(t).length) ? null : card;
}

/**
 * Карточки ИИ перелома: `prefetch` заранее составляет до `want` карточек (по одной, модель параллельно не работает),
 * `take` отдаёт готовую или ждёт текущую не дольше `wait` мс; ничего — null (тогда замена из банка).
 */
export function cardSmith(o: { ask: () => Ask | null; check: (card: Card, c: CardContext) => string[]; perCardMs: number; wait: number }) {
  let key = '';
  let ready: Card[] = [];
  let running: Promise<void> | null = null;
  let seq = 0;
  const one = async (k: string, c: CardContext) => {
    const ask = o.ask();
    if (!ask) return;
    const reply = await within(o.perCardMs, (s) => ask(SYSTEM, cardPrompt(c), s));
    if (k !== key || !reply) return;
    const card = parseCard(reply, c, `ai-${c.front}-${c.n}-${++seq}`, (card) => o.check(card, c));
    if (card) ready.push(card);
  };
  return {
    prefetch(k: string, c: CardContext, want: number) {
      key = k;
      ready = [];
      if (!o.ask()) return;
      running = (async () => {
        const titles = [...c.shownTitles];
        for (let i = 0; i < want * 2 && ready.length < want && k === key; i++) {
          await one(k, { ...c, shownTitles: [...titles, ...ready.map((r) => r.title)] });
        }
      })().finally(() => { if (k === key) running = null; });
    },
    async take(k: string): Promise<Card | null> {
      if (k !== key) return null;
      if (!ready.length && running) await within(o.wait, () => running ?? Promise.resolve());
      return k === key ? ready.shift() ?? null : null;
    },
    reset() { key = ''; ready = []; running = null; },
  };
}

/** Ответ на вопрос: ИИ в срок, иначе готовый ответ, иначе честное «не успеваю». */
export async function answer(ask: Ask | null, question: string, facts: string, ms: number, lines: Lines = LINES): Promise<Said> {
  if (ask) {
    const t = await within(ms, (s) => ask(SYSTEM, `${facts}\nВопрос посетителя: ${question}`, s));
    if (t?.trim() && !textErrors(t.trim()).length) return { text: t.trim(), source: 'now' };
  }
  const a = answerFor(question, lines);
  if (a) return { text: a.a, source: 'prepared' };
  return { text: 'На этот вопрос у меня нет готового ответа. Спросите о решениях, силах или ходе операции.', source: 'prepared' };
}

export type ChoiceKind = 'historical' | 'own' | 'delay';

/** Комментарий выбора: ИИ по фактам хода в срок, иначе заготовка с подстановками. */
export async function comment(ask: Ask | null, kind: ChoiceKind, facts: string, vars: Vars, ms: number, lines: Lines = LINES): Promise<Said | null> {
  if (ask) {
    const t = await within(ms, (s) => ask(SYSTEM, `${facts}\nПрокомментируй выбор посетителя и его последствия по этим фактам.`, s));
    if (t?.trim() && !textErrors(t.trim()).length) return { text: t.trim(), source: 'now' };
  }
  const t = pick(lines.comment[kind], vars);
  return t ? { text: t, source: 'prepared' } : null;
}
