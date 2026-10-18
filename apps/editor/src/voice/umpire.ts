/**
 * Доклад посредника после хода — голосом посредника (роль голоса umpire), 3–5 фраз: что изменилось, главные события,
 * продвижение к целям, оценка посредника; в конце игры — исход. С моделью (настройки «ИИ», модель голоса, без
 * инструментов) — её короткий текст по тем же данным; пока модель готовит — посредник так и говорит; без модели, при
 * сбое или ответе не докладом — честно, почему, и доклад по данным расчёта (umpireReport). Чистый модуль
 * (без React): CommandView зовёт announceTurn, когда ход посчитан.
 *
 * Поздний ответ модели о прошлом ходе не звучит (пришёл новый ход). Раздел «Переигровка» в фоне — посредник говорит
 * коротко, где доклад; «повтори доклад» (command.umpire.repeat) — целиком. Голосом пользовались недавно — после доклада
 * штаб подсказывает, что дальше (в конце игры — предлагает разбор, «да» — составить).
 */
import type { GameRecord } from '@def-ops/sim';
import type { AiStatus, TurnView } from '../sim/game-protocol';
import { inReplay } from './actions/command';
import { propose, retract, setVoiceNote, speak, voiceLive, voiceRecent } from './registry';
import { dayMonth, sentence } from './report';
import { plural, speakable } from './speech';

/** Фраз в докладе посредника. */
export const UMPIRE_MIN = 3;
export const UMPIRE_MAX = 5;

const hour = (t: string) => (t.slice(14, 16) === '00' ? `${+t.slice(11, 13)} ${plural(+t.slice(11, 13), ['час', 'часа', 'часов'])}` : t.slice(11, 16));
const pct = (x: number) => `${Math.round(x * 100)} %`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`);
const goalName = (title: string) => title.split(':')[0].trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Предложения текста (после озвучки). */
const split = (t: string) => (t.match(/[^.!?…]+[.!?…]+["»]?/g) ?? []).map((x) => x.trim()).filter(Boolean);

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

/** Контрольные события, достигнутые за этот ход (после хода prev). */
function reachedNow(v: TurnView, prev?: TurnView | null): string[] {
  return v.goals.filter((g) => g.simulated && (!prev || g.simulated > prev.time || !prev.goals.find((p) => p.title === g.title)?.simulated)).map((g) => goalName(g.title));
}

/**
 * Доклад посредника по правилам: исход (если игра окончена), итоги хода, главные донесения, продвижение к целям,
 * численность, поправка посредника. 3–5 фраз, готово к озвучке.
 */
export function umpireReport(v: TurnView, record: GameRecord | null, _ai: AiStatus | null, prev?: TurnView | null): string {
  const head: string[] = v.over && v.outcome
    ? [`Игра окончена: ${v.outcome.result === 'victory' ? 'победа' : 'поражение'}.`, sentence(v.outcome.text)]
    : [`Итоги хода на ${hour(v.time)} ${dayMonth(v.time)}.`];
  const events = v.events.map(sentence);
  const now = reachedNow(v, prev);
  const done = v.goals.filter((g) => g.simulated).length;
  const next = v.goals.find((g) => !g.simulated);
  const goal = v.over
    ? (v.goals.length ? `Контрольных событий случилось: ${done} из ${v.goals.length}.` : '')
    : now.length ? `Достигнуто: ${list(now)}.`
      : next ? `Следующая цель — ${goalName(next.title)}; в истории — ${dayMonth(next.historical)}.` : '';
  const strength = `В строю ${pct(v.strength)} исходной численности${prev && Math.round((prev.strength - v.strength) * 100) >= 1 ? `, за ход потеряно ${pct(prev.strength - v.strength)}` : ''}.`;
  // посредник о ходе: его оценка боёв (umpireNote), иначе — первая поправка
  const u = umpireTurn(record);
  const umpire = u.note ? `Оценка посредника: ${low(sentence(u.note))}` : u.mods[0] ? `Поправка посредника: ${u.mods[0].replace(/[.\s]+$/, '')}.` : '';
  // обязательное — исход или итоги, главное событие, цели, численность; затем поправка и ещё события, пока есть место
  const parts = [...head, events[0] ?? 'За ход существенных событий нет.'];
  const tail = [goal, strength].filter(Boolean);
  const extra = [umpire, ...events.slice(1)].filter(Boolean);
  while (extra.length && parts.length + tail.length < UMPIRE_MAX) {
    const x = extra.shift()!;
    if (x === umpire) tail.push(x); else parts.push(x);
  }
  return speakable([...parts, ...tail].join(' '), { full: true });
}

/** Системный текст модели — от лица посредника. */
export const UMPIRE_SYSTEM = [
  'Ты — посредник штабной игры по операции Великой Отечественной войны. После каждого хода ты устно докладываешь командующему итоги хода.',
  'Доклад — от трёх до пяти коротких фраз: что изменилось, главные события, продвижение к целям операции. Только по данным ниже, ничего не выдумывай.',
  'Не раскрывай замыслов и приказов противника. Без списков, разметки, английских слов и сокращений. Все числа и даты — словами.',
].join('\n');

/** Данные хода для модели — то же, из чего строится доклад по правилам. */
export function umpireInput(v: TurnView, record: GameRecord | null, prev?: TurnView | null): string {
  const u = umpireTurn(record);
  return [
    `Операция: ${v.scenarioName}. Ход ${v.turn - 1} закончен, время ${v.time.replace('T', ' ')}. Сторона командующего: ${v.human.name}.`,
    v.over && v.outcome ? `Игра окончена: ${v.outcome.result === 'victory' ? 'победа' : 'поражение'} — ${v.outcome.text}` : '',
    `Цель операции: ${v.victory}; предельный срок ${v.deadline.slice(0, 10)}.`,
    `В строю ${pct(v.strength)} исходной численности${prev ? ` (ход назад — ${pct(prev.strength)})` : ''}.`,
    'Донесения за ход:', ...(v.events.length ? v.events.map((e) => `- ${e}`) : ['- существенных событий нет']),
    'Контрольные события операции:', ...v.goals.map((g) => `- ${g.title}: ${g.simulated ? `достигнуто ${g.simulated.slice(0, 10)}` : 'ещё нет'} (в истории ${g.historical.slice(0, 10)})`),
    u.note ? `Оценка посредника по ожидаемым боям: ${u.note}` : '',
    ...u.mods.slice(0, 3).map((m) => `Поправка посредника: ${m}`),
  ].filter(Boolean).join('\n');
}

/** Ответ модели к озвучке: числа словами, не больше пяти фраз; меньше трёх — не годится (null). */
export function umpireFromModel(text: string): string | null {
  const ss = split(speakable(text.replace(/[*_#>`]+/g, ' ').replace(/^\s*[-•]\s*/gm, ''), { full: true })).map(cap);
  return ss.length >= UMPIRE_MIN ? ss.slice(0, UMPIRE_MAX).join(' ') : null;
}

/** Модель посредника: системный текст, данные, отмена (обычный срок и повторы llm.ts). */
export type UmpireModel = (system: string, text: string, o: { signal: AbortSignal }) => Promise<string>;

let seq = 0;
let lastText: string | null = null;
let pending: AbortController | null = null;
/** Последний доклад посредника (для «повтори доклад»; null — докладов не было). */
export function lastUmpire(): string | null { return lastText; }
/** Забыть доклады (новая игра, выход). Ждущий ответ модели отменяется. */
export function resetUmpire(): void { seq++; lastText = null; pending?.abort(); pending = null; setVoiceNote(null); }

export const UMPIRE_WAIT_SAY = 'Сведения о ходе готовятся, прошу подождать.';
export const UMPIRE_STILL_SAY = 'Сведения ещё готовятся.';
/** Пока модель готовит доклад — напоминать не чаще этого. */
export const UMPIRE_REMIND_MS = 20_000;
export const UMPIRE_NOTE = 'Посредник готовит доклад';
export const UMPIRE_NO_MODEL = 'Модель недоступна — докладываю по данным расчёта.';
export const UMPIRE_FAILED = 'Модель не ответила — докладываю по данным расчёта.';
export const UMPIRE_UNFIT = 'Ответ модели не годится для доклада — докладываю по данным расчёта.';
export const UMPIRE_AWAY = 'Доклад посредника готов — в разделе «Переигровка»: скажите «повтори доклад».';
export const NEXT_TURN_SAY = 'Решение на следующий ход: скажите «дай варианты» или «доложи обстановку».';
export const REVIEW_OFFER = 'Составить разбор операции?';

const say = (text: string) => speak(text, { role: 'umpire', keep: true });

/**
 * Ход посчитан. Голос не слышит (выключен, дежурит, сервис не на связи) — модель не спрашивается: доклад по данным
 * расчёта готовится для «повтори доклад», штаб противника не ждёт. С моделью: посредник сразу говорит, что сведения
 * готовятся (на панели — «Посредник готовит доклад»; «Переигровка» в фоне — только на панели), ждёт её ответа (обычный
 * срок и повторы llm.ts), пока ждёт — не чаще раза в UMPIRE_REMIND_MS «Сведения ещё готовятся» (не копятся: новое
 * снимает прежнее, если оно ещё не прозвучало); ответила — её доклад. Доклад по данным расчёта — только если модель
 * недоступна, не ответила или ответила не докладом, и тогда — честно, почему. Фразы не устаревают от реплик человека
 * (keep). Затем — штаб: что дальше (если голосом пользовались недавно); в конце игры — предложение разбора.
 * onDone — доклад этого хода закончен (снятый новым ходом — нет: у нового свой): штаб противника ждёт его, чтобы не
 * занимать модель раньше посредника.
 */
export async function announceTurn(a: { view: TurnView; prev?: TurnView | null; record: GameRecord | null; ai: AiStatus | null; model?: UmpireModel | null; onDone?(): void }): Promise<void> {
  const my = ++seq;
  pending?.abort();
  pending = null;
  setVoiceNote(null);
  const rules = umpireReport(a.view, a.record, a.ai, a.prev);
  if (!voiceLive()) { lastText = rules; a.onDone?.(); return; }
  try {
    let text = rules, why: string | null = UMPIRE_NO_MODEL;
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
        const m = umpireFromModel(await a.model(UMPIRE_SYSTEM, umpireInput(a.view, a.record, a.prev), { signal: ac.signal }));
        if (m) { text = m; why = null; } else why = UMPIRE_UNFIT;
      } catch { why = UMPIRE_FAILED; } finally {
        clearInterval(remind);
        if (pending === ac) { pending = null; setVoiceNote(null); }
      }
    }
    if (my !== seq) return; // пришёл новый ход или игра закончена — поздний доклад не звучит
    lastText = text;
    // «Переигровка» в фоне: одной фразой, где доклад (подсказки фраз здесь не исполнятся)
    if (inReplay() !== true) { say(UMPIRE_AWAY); return; }
    if (why) say(why);
    say(text);
    if (!voiceRecent()) return;
    if (a.view.over) propose(REVIEW_OFFER, 'command.review.compose', {});
    else speak(NEXT_TURN_SAY, { keep: true });
  } finally { if (my === seq) a.onDone?.(); }
}

/** Повторить последний доклад голосом посредника. */
export function repeatUmpire(): string | null {
  if (!lastText) return null;
  speak(lastText, { role: 'umpire' });
  return lastText;
}

