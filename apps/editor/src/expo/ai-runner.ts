/**
 * Исполнитель голосовых эффектов режиссёра и вопросов к ИИ (главное окно).
 *
 * say — заготовка по ключу с подстановками из хода (со сценой, к которой она относится); scene — смена сцены (голос
 * обрывает фразу ушедшей); newSession — тишина и чистый экран ИИ; ask — ответ (ИИ в срок или заготовка; пока ИИ думает —
 * его «мысль» на экране, голос молчит); listen — одна реплика с микрофона: команда сеанса («выбираю второй»,
 * «расскажи подробнее», «начать заново») или вопрос. После решения — комментарий как ответ на действие посетителя.
 * Кадр ИИ (что звучит, ответ, мысль) уходит в `onFrame` и рассылается окнам.
 */
import { answer, comment, type Ask, type ChoiceKind, type Said } from './ai';
import { commanderVoice, debriefUtterances } from './debrief';
import type { DirectorEvent, Effect } from './director';
import { LINES, pick, pickFilled, type Filled, type Lines, type Vars } from './lines';
import { norm } from '../voice/fuzzy';
import type { Line, voiceQueue } from './voice-queue';
import { INTRO_CUES, INTRO_KEYS, introGap } from './intro-story';

export type Ear = 'idle' | 'listen' | 'speak';
export interface AiFrame {
  /** Номер сцены интро: запись или тихий отмеренный кадр. */
  introLine?: number;
  /** Общее время режиссёра при начале сцены и длина записи (либо тихой сцены). */
  introCueStartedAt?: number;
  introCueDurationMs?: number;
  /** Что сейчас звучит (субтитр) и откуда. */
  line: { text: string; source: string } | null;
  /** Последняя звучавшая фраза: остаётся, когда очередь замолкает. */
  said: string | null;
  answer: { q: string; text: string; source: Said['source'] | null } | null;
  thinking: string | null;
  /** Слушаю посетителя, отвечаю или молчу. */
  ear: Ear;
}
export const NO_AI: AiFrame = { line: null, said: null, answer: null, thinking: null, ear: 'idle' };

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
  /** Одна реплика с микрофона; null — распознавания нет. Повторный вызов, пока слушаем, — конец записи. */
  listen?: (() => Promise<string | null>) | null;
  /** Закончить текущую запись и отдать сказанное. */
  stopListen?: () => void;
  onFrame: (f: AiFrame) => void;
  /** Срок ответа на вопрос, мс. Комментарий решения ждём до конца. */
  answerMs?: number;
  lines?: Lines;
  /** Учёт: ответ ИИ вовремя или заменён заготовкой. */
  count?: (kind: 'aiOnTime' | 'aiFallback') => void;
  /** Заготовка озвучена заранее (из таких и выбирается, если они есть). */
  voiced?: (f: Filled) => boolean;
  /** Длина готовой записи; нет записи — срок сцены из монтажа. */
  duration?: (f: Filled) => number | null;
  now?: () => number;
  /** Разбор итога голосом маршала, абзацами. Нет итога — обычная заготовка `result`. */
  debrief?: () => { paragraphs: string[]; voice: string } | null;
}

export function aiRunner(d: AiRunnerDeps) {
  const lines = d.lines ?? LINES;
  let frame: AiFrame = NO_AI;
  let gen = 0;
  let commentRequest: AbortController | null = null;
  const set = (p: Partial<AiFrame>) => { frame = { ...frame, ...p }; d.onFrame(frame); };
  const say = (text: string, priority: Line['priority'], source: string, more: Pick<Line, 'parts' | 'fallback' | 'scene' | 'voice' | 'gapMs' | 'replace' | 'mark' | 'durationMs'> = {}) =>
    d.queue.push({ text, priority, source, ...more });
  const tally = (s: Said) => { if (d.ask()) d.count?.(s.source === 'now' ? 'aiOnTime' : 'aiFallback'); };

  const ask = async (q: string) => {
    const g = ++gen;
    const thinking = pick(lines.thinking) ?? 'Думаю…';
    set({ answer: { q, text: '', source: null }, thinking: d.ask() ? thinking : null });
    d.dispatch({ t: 'timerHold' });
    const f = d.facts();
    try {
      const a = await answer(d.ask(), q, f.text, d.answerMs ?? 90_000, lines);
      if (g !== gen) return;
      tally(a);
      set({ answer: { q, text: a.text, source: a.source }, thinking: null });
      // целиком собранный ответ — затем звук; таймер отпустится, когда фраза доиграет
      await say(a.text, 'action', a.source);
    } finally {
      d.dispatch({ t: 'timerRelease' });
    }
  };

  return {
    frame: () => frame,
    shiftIntroClock(ms: number) {
      if (frame.introCueStartedAt !== undefined) set({ introCueStartedAt: frame.introCueStartedAt + ms });
    },
    /** Сказанная очередью фраза (субтитр). */
    onLine(l: Line | null) {
      const intro = l?.scene === 'intro' && l.mark ? INTRO_KEYS.indexOf(l.mark) : -1;
      set({
        ...(intro >= 0 ? { introLine: intro + 1, introCueStartedAt: d.now?.() ?? 0, introCueDurationMs: l?.durationMs ?? INTRO_CUES[intro].durationMs } : {}),
        line: l ? { text: l.text, source: l.source } : null,
        ...(l ? { said: l.text, ear: 'speak' as const } : frame.ear === 'speak' ? { ear: 'idle' as const } : {}),
      });
    },
    handle(e: Effect) {
      if (e.e === 'say') {
        if (e.key === 'marshal-su_1bf' || e.key === 'marshal-su_1uf') {
          const f = pickFilled(lines.say[e.key], d.facts().vars, Math.random, d.voiced);
          if (f) say(f.text, e.priority, 'prepared', { parts: f.parts, replace: true, ...(e.scene ? { scene: e.scene } : {}) });
        } else {
        const brief = e.key === 'result' ? d.debrief?.() : null;
        if (brief) {
          const f = pickFilled(lines.say.result, d.facts().vars, Math.random, d.voiced);
          const sentences = debriefUtterances(brief.paragraphs);
          sentences.forEach((text, i) => {
            say(text, e.priority, 'now', {
              voice: brief.voice,
              ...(e.scene ? { scene: e.scene } : {}),
              ...(i === 0 && f ? { fallback: { text: f.text, parts: f.parts } } : {}),
            });
          });
        } else {
          const f = pickFilled(lines.say[e.key], d.facts().vars, Math.random, d.voiced);
          const intro = e.scene === 'intro' ? INTRO_CUES.find((cue) => cue.key === e.key) : undefined;
          if (f) say(f.text, e.priority, 'prepared', { parts: f.parts, ...(e.scene ? { scene: e.scene } : {}), ...(intro ? { mark: e.key, gapMs: introGap(INTRO_KEYS.indexOf(e.key)), durationMs: d.duration?.(f) ?? intro.durationMs } : {}) });
        }
        }
      } else if (e.e === 'scene') {
        commentRequest?.abort();
        d.queue.scene(e.key);
        gen++;
        // Последняя реплика относится к прежней сцене: она не должна ни выводиться,
        // ни выбирать фокус карты при открытии итога.
        set({ ...NO_AI, introLine: undefined, introCueStartedAt: undefined, introCueDurationMs: undefined });
      } else if (e.e === 'newSession') {
        commentRequest?.abort();
        gen++;
        d.queue.clear();
        frame = NO_AI;
        d.onFrame(frame);
      } else if (e.e === 'ask') {
        void ask(e.q);
      } else if (e.e === 'listen') {
        if (frame.ear === 'listen') {
          d.stopListen?.();
          return;
        }
        if (!d.listen) return;
        const g = gen;
        set({ ear: 'listen' });
        void d.listen().then((text) => {
          if (g !== gen) { d.dispatch({ t: 'timerRelease' }); return; }
          if (frame.ear === 'listen') set({ ear: 'idle' });
          if (!text) { d.dispatch({ t: 'timerRelease' }); return; }
          void ask(text);
        }, () => {
          if (g === gen && frame.ear === 'listen') set({ ear: 'idle' });
          d.dispatch({ t: 'timerRelease' });
        });
      }
    },
    /** После решения перелома: комментарий выбора по фактам хода. */
    async decided(kind: ChoiceKind, scene = d.queue.sceneNow() ?? undefined) {
      const g = gen;
      const f = d.facts();
      set({ thinking: 'Готовим комментарий' });
      commentRequest?.abort();
      const request = new AbortController();
      commentRequest = request;
      const c = await comment(d.ask(), kind, f.text, f.vars, lines, d.voiced, request.signal);
      if (commentRequest === request) commentRequest = null;
      if (g === gen) set({ thinking: null });
      if (g !== gen || !c) return;
      tally(c);
      const fallback = c.source === 'now' ? await comment(null, kind, '', f.vars, lines, d.voiced) : null;
      if (g !== gen) return;
      // заготовка уже в записи и звучит сразу; живой комментарий — голосом командующего, не диктора
      const marshal = typeof f.vars.marshal === 'string' ? f.vars.marshal : undefined;
      const voice = c.source === 'now' ? commanderVoice(marshal) : undefined;
      await say(c.text, 'scene', c.source, { parts: c.parts, ...(scene ? { scene } : {}), ...(voice ? { voice } : {}), ...(fallback ? { fallback } : {}) });
    },
    /** Ответ на вопрос мимо режиссёра (для проверок). */
    ask,
  };
}
