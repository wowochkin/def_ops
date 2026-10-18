/**
 * Посредник после хода — разбор прошедшего хода на карте, как тур (voice/tours/turn.ts): голосом посредника (роль
 * голоса umpire) по шагам — общее (карта проигрывает ход), главные бои (место — метка и рамка), цели, тыл, что известно
 * о противнике. Сразу после хода посредник говорит, что сведения готовятся; текст шагов — моделью одним запросом на
 * весь разбор (настройки «ИИ», модель голоса, без инструментов); без модели, при сбое или ответе не по шагам — честно,
 * почему, и по данным расчёта. Чистый модуль (без React): CommandView зовёт announceTurn, когда ход посчитан; тур
 * запускает слой тура (setReviewRunner), без него — текст шагов звучит подряд.
 *
 * Голос не слышит (выключен, дежурит) — разбор сам не начинается и модель не спрашивается: он готов по данным расчёта
 * для «Штаб, покажи ход» и кнопки «Разбор хода». Поздний ответ модели о прошлом ходе не звучит (пришёл новый ход).
 * Раздел «Переигровка» в фоне — посредник говорит коротко, где разбор. Голосом пользовались недавно — после разбора
 * штаб подсказывает, что дальше (в конце игры — предлагает разбор операции, «да» — составить).
 */
import type { GameRecord } from '@def-ops/sim';
import type { AiStatus, TurnView } from '../sim/game-protocol';
import { inReplay } from './actions/command';
import { propose, retract, setVoiceNote, speak, voiceLive, voiceRecent } from './registry';
import { sentence } from './report';
import { speakable } from './speech';
import { REVIEW_SYSTEM, reviewFromModel, reviewInput, reviewTour, turnReview, type ReviewStep } from './tours/turn';
import type { Tour } from './tours';

/** Что посредник записал о ходе (GameTurn.umpire, umpireNote — unknown в записи): только то, что годится. */
interface UmpireTurn { mods: string[]; note: string | null }
function umpireTurn(record: GameRecord | null): UmpireTurn {
  const t = record?.turns[record.turns.length - 1] as { umpire?: unknown; umpireNote?: unknown } | undefined;
  const mods = Array.isArray(t?.umpire) ? t.umpire.map((m) => (m && typeof m === 'object' && typeof (m as { reason?: unknown }).reason === 'string' ? (m as { reason: string }).reason : '')).filter(Boolean) : [];
  const n = t?.umpireNote;
  const note = n && typeof n === 'object' && (n as { ok?: unknown }).ok === true && typeof (n as { assessment?: unknown }).assessment === 'string' && (n as { assessment: string }).assessment.trim()
    ? (n as { assessment: string }).assessment : null;
  return { mods, note };
}
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Шаги разбора хода: из данных хода (turnReview); в общем шаге — оценка посредника по боям (umpireNote), иначе первая
 * его поправка.
 */
export function reviewSteps(v: TurnView, prev: TurnView | null, record: GameRecord | null): ReviewStep[] {
  const steps = turnReview(v, prev);
  const u = umpireTurn(record);
  const add = u.note ? `Оценка посредника: ${low(sentence(u.note))}` : u.mods[0] ? `Поправка посредника: ${u.mods[0].replace(/[.\s]+$/, '')}.` : '';
  const i = steps.findIndex((x) => x.kind === 'overview');
  if (add && i >= 0) steps[i] = { ...steps[i], text: `${steps[i].text} ${speakable(add, { full: true })}`, facts: `${steps[i].facts} ${add}` };
  return steps;
}

/** Модель посредника: системный текст, данные, отмена (обычный срок и повторы llm.ts). */
export type UmpireModel = (system: string, text: string, o: { signal: AbortSignal }) => Promise<string>;

let seq = 0;
let lastText: string | null = null;
/** Последний разбор хода: время хода, шаги и тексты модели (null — по правилам). */
let last: { time: string; steps: ReviewStep[]; texts: string[] | null } | null = null;
let pending: AbortController | null = null;
const sentences = (t: string) => t.match(/[^.!?…]+[.!?…]+["»]?/g)?.map((x) => x.trim()) ?? (t.trim() ? [t.trim()] : []);
/**
 * Краткий доклад: итог игры (если она окончена) и общий шаг — 2–3 фразы (длинный общий шаг: первая и две последние).
 * Весь разбор — «подробнее», «покажи ход».
 */
export function briefReview(steps: ReviewStep[], texts: string[] | null): string {
  const at = (i: number) => texts?.[i] ?? steps[i].text;
  const out: string[] = [];
  const end = steps.findIndex((x) => x.kind === 'outcome');
  if (end >= 0) out.push(...sentences(at(end)).slice(0, 1));
  const ov = steps.findIndex((x) => x.kind === 'overview');
  const s = sentences(ov >= 0 ? at(ov) : steps.length ? at(0) : '');
  out.push(...(s.length > 3 ? [s[0], ...s.slice(-2)] : s));
  return out.join(' ');
}
/** Краткий доклад о последнем ходе (для «повтори доклад»: общий шаг и итог; null — разборов не было). */
export function lastUmpire(): string | null { return lastText; }
/** Забыть разборы (новая игра, выход). Ждущий ответ модели отменяется. */
export function resetUmpire(): void { seq++; lastText = null; last = null; pending?.abort(); pending = null; setVoiceNote(null); }

/** Запуск тура разбора (слой тура, voice/tour.tsx): onEnd — тур кончился (дошёл, «хватит», ушли из раздела). */
export type ReviewRunner = (tour: Tour, onEnd: () => void) => void;
let runner: ReviewRunner | null = null;
/** Слой тура подключает запуск разбора; возвращает отключение (снимает только своё). */
export function setReviewRunner(r: ReviewRunner | null): () => void {
  runner = r;
  return () => { if (runner === r) runner = null; };
}

export const UMPIRE_WAIT_SAY = 'Сведения о ходе готовятся, прошу подождать.';
export const UMPIRE_STILL_SAY = 'Сведения ещё готовятся.';
/** Пока модель готовит разбор — напоминать не чаще этого. */
export const UMPIRE_REMIND_MS = 20_000;
export const UMPIRE_NOTE = 'Посредник готовит разбор хода';
export const UMPIRE_NO_MODEL = 'Модель недоступна — разбор по данным расчёта.';
export const UMPIRE_FAILED = 'Модель не ответила — разбор по данным расчёта.';
export const UMPIRE_UNFIT = 'Ответ модели не годится для разбора — разбор по данным расчёта.';
export const UMPIRE_AWAY = 'Разбор хода готов — в разделе «Переигровка»: скажите «покажи ход».';
export const NEXT_TURN_SAY = 'Решение на следующий ход: скажите «дай варианты» или «доложи обстановку».';
export const REVIEW_OFFER = 'Составить разбор операции?';

const say = (text: string) => speak(text, { role: 'umpire', keep: true });

/** Показать разбор: тур на карте (слой тура подключён) или текст шагов подряд; then — когда кончился. */
function show(tour: Tour, then?: () => void): void {
  if (runner) { runner(tour, () => then?.()); return; }
  say(tour.steps.map((x) => x.text).join(' '));
  then?.();
}

/**
 * Ход посчитан. Голос не слышит (выключен, дежурит, сервис не на связи) — модель не спрашивается, разбор сам не
 * начинается: он готов по данным расчёта для «покажи ход» и кнопки «Разбор хода», штаб противника не ждёт. С моделью:
 * посредник сразу говорит, что сведения готовятся (на панели — «Посредник готовит разбор хода»; «Переигровка» в фоне —
 * только на панели), ждёт её ответа (обычный срок и повторы llm.ts), пока ждёт — не чаще раза в UMPIRE_REMIND_MS
 * «Сведения ещё готовятся» (не копятся: новое снимает прежнее, если оно ещё не прозвучало); ответила — её тексты
 * шагов. По данным расчёта — только если модель недоступна, не ответила или ответила не по шагам, и тогда — честно,
 * почему. Затем разбор на карте; после него — штаб: что дальше (если голосом пользовались недавно); в конце игры —
 * предложение разбора операции. onDone — тексты разбора этого хода готовы (снятый новым ходом — нет: у нового свой):
 * штаб противника ждёт его, чтобы не занимать модель раньше посредника.
 */
export async function announceTurn(a: { view: TurnView; prev?: TurnView | null; record: GameRecord | null; ai: AiStatus | null; model?: UmpireModel | null; onDone?(): void }): Promise<void> {
  const my = ++seq;
  pending?.abort();
  pending = null;
  setVoiceNote(null);
  const steps = reviewSteps(a.view, a.prev ?? null, a.record);
  if (!voiceLive()) { last = { time: a.view.time, steps, texts: null }; lastText = briefReview(steps, null); a.onDone?.(); return; }
  try {
    let texts: string[] | null = null, why: string | null = UMPIRE_NO_MODEL;
    if (a.model) {
      const ac = new AbortController();
      pending = ac;
      if (inReplay() === true) say(UMPIRE_WAIT_SAY);
      setVoiceNote(UMPIRE_NOTE);
      let reminder: number | void;
      const remind = setInterval(() => {
        if (pending !== ac || inReplay() !== true) return;
        if (typeof reminder === 'number') retract(reminder); // не звучало — заменить, а не копить
        reminder = say(UMPIRE_STILL_SAY);
      }, UMPIRE_REMIND_MS);
      try {
        texts = reviewFromModel(await a.model(REVIEW_SYSTEM, reviewInput(a.view, steps), { signal: ac.signal }), steps.length);
        why = texts ? null : UMPIRE_UNFIT;
      } catch { why = UMPIRE_FAILED; } finally {
        clearInterval(remind);
        if (pending === ac) { pending = null; setVoiceNote(null); }
      }
    }
    if (my !== seq) return; // пришёл новый ход или игра закончена — поздний разбор не звучит
    last = { time: a.view.time, steps, texts };
    lastText = briefReview(steps, texts);
    // голос выключили, пока ждали модель, — разбор сам не начинается (доклад сохранён: «покажи ход», «повтори доклад»)
    if (!voiceLive()) return;
    // «Переигровка» в фоне: одной фразой, где разбор (карты там нет)
    if (inReplay() !== true) { say(UMPIRE_AWAY); return; }
    if (why) say(why);
    const over = a.view.over;
    show(reviewTour(steps, texts), () => {
      if (!voiceRecent()) return;
      if (over) propose(REVIEW_OFFER, 'command.review.compose', {});
      else speak(NEXT_TURN_SAY, { keep: true });
    });
  } finally { if (my === seq) a.onDone?.(); }
}

/**
 * «Штаб, покажи ход», кнопка «Разбор хода»: разбор последнего хода ещё раз — каким он был (тексты модели), а если его
 * не было (голос не слышал, игра продолжена после перезапуска) — по данным расчёта.
 */
export function showTurnReview(v: TurnView, prev: TurnView | null, record: GameRecord | null): void {
  const r = last && last.time === v.time ? last : { steps: reviewSteps(v, prev, record), texts: null };
  show(reviewTour(r.steps, r.texts));
}

/** Повторить краткий доклад о последнем ходе голосом посредника. */
export function repeatUmpire(): string | null {
  if (!lastText) return null;
  speak(lastText, { role: 'umpire' });
  return lastText;
}
