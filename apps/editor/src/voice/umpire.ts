/**
 * Доклад посредника после хода — голосом посредника (роль голоса umpire), 3–5 фраз: что изменилось, главные события,
 * продвижение к целям; в конце игры — исход. С моделью (настройки «ИИ», модель голоса, без инструментов) — её короткий
 * текст по тем же данным; без модели, при сбое или слишком коротком ответе — по правилам (umpireReport). Чистый модуль
 * (без React): CommandView зовёт announceTurn, когда ход посчитан.
 *
 * Поздний ответ модели о прошлом ходе не звучит (пришёл новый ход). Раздел «Переигровка» в фоне — посредник говорит
 * коротко, где доклад; «повтори доклад» (command.umpire.repeat) — целиком. Голосом пользовались недавно — после доклада
 * штаб подсказывает, что дальше (в конце игры — предлагает разбор, «да» — составить).
 */
import type { GameRecord } from '@def-ops/sim';
import type { AiStatus, TurnView } from '../sim/game-protocol';
import { inReplay } from './actions/command';
import { propose, speak, voiceRecent } from './registry';
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

type UmpireMod = { reason?: string };

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
  const turn = record?.turns[record.turns.length - 1] as { umpire?: UmpireMod[] } | undefined;
  const mod = turn?.umpire?.find((m) => m.reason)?.reason;
  const umpire = mod ? `Поправка посредника: ${mod.replace(/[.\s]+$/, '')}.` : '';
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
  const turn = record?.turns[record.turns.length - 1] as { umpire?: UmpireMod[]; umpireNote?: { ok?: boolean; assessment?: string } } | undefined;
  return [
    `Операция: ${v.scenarioName}. Ход ${v.turn - 1} закончен, время ${v.time.replace('T', ' ')}. Сторона командующего: ${v.human.name}.`,
    v.over && v.outcome ? `Игра окончена: ${v.outcome.result === 'victory' ? 'победа' : 'поражение'} — ${v.outcome.text}` : '',
    `Цель операции: ${v.victory}; предельный срок ${v.deadline.slice(0, 10)}.`,
    `В строю ${pct(v.strength)} исходной численности${prev ? ` (ход назад — ${pct(prev.strength)})` : ''}.`,
    'Донесения за ход:', ...(v.events.length ? v.events.map((e) => `- ${e}`) : ['- существенных событий нет']),
    'Контрольные события операции:', ...v.goals.map((g) => `- ${g.title}: ${g.simulated ? `достигнуто ${g.simulated.slice(0, 10)}` : 'ещё нет'} (в истории ${g.historical.slice(0, 10)})`),
    turn?.umpireNote?.ok && turn.umpireNote.assessment ? `Оценка посредника по ожидаемым боям: ${turn.umpireNote.assessment}` : '',
    ...(turn?.umpire ?? []).filter((m) => m.reason).slice(0, 3).map((m) => `Поправка посредника: ${m.reason}`),
  ].filter(Boolean).join('\n');
}

/** Ответ модели к озвучке: числа словами, не больше пяти фраз; меньше трёх — не годится (null). */
export function umpireFromModel(text: string): string | null {
  const ss = split(speakable(text.replace(/[*_#>`]+/g, ' ').replace(/^\s*[-•]\s*/gm, ''), { full: true })).map(cap);
  return ss.length >= UMPIRE_MIN ? ss.slice(0, UMPIRE_MAX).join(' ') : null;
}

/** Модель посредника: системный текст, данные, отмена. */
export type UmpireModel = (system: string, text: string, o: { signal: AbortSignal }) => Promise<string>;

let seq = 0;
let lastText: string | null = null;
let pending: AbortController | null = null;
/** Последний доклад посредника (для «повтори доклад»; null — докладов не было). */
export function lastUmpire(): string | null { return lastText; }
/** Забыть доклады (новая игра, выход). Ждущий ответ модели отменяется. */
export function resetUmpire(): void { seq++; lastText = null; pending?.abort(); pending = null; }

export const UMPIRE_AWAY = 'Ход посчитан. Доклад посредника — в разделе «Переигровка»: скажите «повтори доклад».';
export const NEXT_TURN_SAY = 'Решение на следующий ход: скажите «дай варианты» или «доложи обстановку».';
export const REVIEW_OFFER = 'Составить разбор операции?';

/**
 * Ход посчитан: доклад посредника его голосом (с моделью, если дана; иначе или при сбое — по правилам), затем — штаб:
 * что дальше (если голосом пользовались недавно); в конце игры — предложение разбора.
 */
export async function announceTurn(a: { view: TurnView; prev?: TurnView | null; record: GameRecord | null; ai: AiStatus | null; model?: UmpireModel | null }): Promise<void> {
  const my = ++seq;
  pending?.abort();
  pending = null;
  let text = umpireReport(a.view, a.record, a.ai, a.prev);
  if (a.model) {
    const ac = new AbortController();
    pending = ac;
    try {
      const m = umpireFromModel(await a.model(UMPIRE_SYSTEM, umpireInput(a.view, a.record, a.prev), { signal: ac.signal }));
      if (m) text = m;
    } catch { /* модель недоступна — по правилам */ }
    if (pending === ac) pending = null;
  }
  if (my !== seq) return; // пришёл новый ход или игра закончена — поздний доклад не звучит
  lastText = text;
  // «Переигровка» в фоне: доклад звучит там (подсказки фраз здесь не исполнятся)
  if (inReplay() !== true) { speak(UMPIRE_AWAY, { role: 'umpire', keep: true }); return; }
  speak(text, { role: 'umpire', keep: true });
  if (!voiceRecent()) return;
  if (a.view.over) propose(REVIEW_OFFER, 'command.review.compose', {});
  else speak(NEXT_TURN_SAY, { keep: true });
}

/** Повторить последний доклад голосом посредника. */
export function repeatUmpire(): string | null {
  if (!lastText) return null;
  speak(lastText, { role: 'umpire' });
  return lastText;
}

