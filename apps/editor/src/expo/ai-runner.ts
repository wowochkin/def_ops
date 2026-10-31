/**
 * Исполнитель голосовых эффектов режиссёра и вопросов к ИИ (главное окно).
 *
 * say — заготовка по ключу с подстановками из хода; newSession — тишина и чистый экран ИИ; ask — ответ (ИИ в срок или
 * заготовка; пока ИИ думает — его «мысль» на экране и фоновая фраза голосом); listen — одна реплика с микрофона:
 * команда сеанса («выбираю второй», «расскажи подробнее», «начать заново») или вопрос. После решения — комментарий.
 * Кадр ИИ (что звучит, ответ, мысль) уходит в `onFrame` и рассылается окнам.
 */
import { answer, comment, type Ask, type ChoiceKind, type Said } from './ai';
import type { DirectorEvent, Effect } from './director';
import { LINES, pick, type Lines, type Vars } from './lines';
import { norm } from '../voice/fuzzy';
import type { Line, voiceQueue } from './voice-queue';

export interface AiFrame {
  /** Что сейчас звучит (субтитр) и откуда. */
  line: { text: string; source: string } | null;
  answer: { q: string; text: string; source: Said['source'] | null } | null;
  thinking: string | null;
}
export const NO_AI: AiFrame = { line: null, answer: null, thinking: null };

/** Готовые вопросы кнопки «Спросить ИИ». */
export const QUESTIONS = LINES.answers.map((a) => a.q);

const ORD: Record<string, number> = { перв: 0, один: 0, '1': 0, втор: 1, два: 1, '2': 1, трет: 2, три: 2, '3': 2 };

/** Команда сеанса из реплики или вопрос. */
export function parseSpeech(text: string): DirectorEvent | { ask: string } | null {
  const t = norm(text);
  if (!t) return null;
  if (/(начать|начни|начнем) заново/.test(t)) return { t: 'restart' };
  if (/(расскажи|подробнее)/.test(t) && t.split(' ').length <= 4) return { ask: 'Расскажи подробнее об обстановке на этом переломе' };
  const m = t.match(/(выбираю|выбрать|беру|карточк\p{L}*|вариант\p{L}*|номер)\s+(\S+)/u);
  if (m) {
    const k = Object.keys(ORD).find((p) => m[2].startsWith(p));
    if (k !== undefined) return { t: 'choose', card: ORD[k] };
  }
  return { ask: text.trim() };
}

export interface AiRunnerDeps {
  queue: ReturnType<typeof voiceQueue>;
  /** Модель «С ИИ» (null — без ИИ или не на связи). */
  ask: () => Ask | null;
  /** Факты хода для подсказки модели и подстановки заготовок. */
  facts: () => { text: string; vars: Vars };
  dispatch: (ev: DirectorEvent) => void;
  /** Одна реплика с микрофона; null — распознавания нет. */
  listen?: (() => Promise<string | null>) | null;
  onFrame: (f: AiFrame) => void;
  /** Сроки ответа и комментария, мс. */
  answerMs?: number;
  commentMs?: number;
  lines?: Lines;
  /** Учёт: ответ ИИ вовремя или заменён заготовкой. */
  count?: (kind: 'aiOnTime' | 'aiFallback') => void;
}

export function aiRunner(d: AiRunnerDeps) {
  const lines = d.lines ?? LINES;
  let frame: AiFrame = NO_AI;
  let gen = 0;
  const set = (p: Partial<AiFrame>) => { frame = { ...frame, ...p }; d.onFrame(frame); };
  const say = (text: string, priority: Line['priority'], source: string) => d.queue.push({ text, priority, source });
  const tally = (s: Said) => { if (d.ask()) d.count?.(s.source === 'now' ? 'aiOnTime' : 'aiFallback'); };

  const ask = async (q: string) => {
    const g = ++gen;
    const thinking = pick(lines.thinking) ?? 'Думаю…';
    set({ answer: { q, text: '', source: null }, thinking: d.ask() ? thinking : null });
    if (d.ask()) say(thinking, 'ambient', 'ИИ думает');
    const f = d.facts();
    const a = await answer(d.ask(), q, f.text, d.answerMs ?? 8000, lines);
    if (g !== gen) return;
    tally(a);
    set({ answer: { q, text: a.text, source: a.source }, thinking: null });
    say(a.text, 'action', a.source);
  };

  return {
    frame: () => frame,
    /** Сказанная очередью фраза (субтитр). */
    onLine(l: Line | null) { set({ line: l ? { text: l.text, source: l.source } : null }); },
    handle(e: Effect) {
      if (e.e === 'say') {
        const t = pick(lines.say[e.key], d.facts().vars);
        if (t) say(t, e.priority, 'prepared');
      } else if (e.e === 'newSession') {
        gen++;
        d.queue.clear();
        frame = NO_AI;
        d.onFrame(frame);
      } else if (e.e === 'ask') {
        void ask(e.q);
      } else if (e.e === 'listen') {
        if (!d.listen) return;
        const g = gen;
        void d.listen().then((text) => {
          if (g !== gen || !text) return;
          const r = parseSpeech(text);
          if (!r) return;
          if ('ask' in r) void ask(r.ask);
          else d.dispatch(r);
        }, () => {});
      }
    },
    /** После решения перелома: комментарий выбора по фактам хода. */
    async decided(kind: ChoiceKind) {
      const g = gen;
      const f = d.facts();
      const c = await comment(d.ask(), kind, f.text, f.vars, d.commentMs ?? 12000, lines);
      if (g !== gen || !c) return;
      tally(c);
      say(c.text, 'event', c.source);
    },
    /** Ответ на вопрос мимо режиссёра (для проверок). */
    ask,
  };
}
