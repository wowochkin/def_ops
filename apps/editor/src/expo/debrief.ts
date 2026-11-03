/**
 * Разбор итога голосом командующего выбранного фронта. Текст собирается из фактов этого сеанса,
 * поэтому заранее не записывается: его читает живой голос Жукова или Конева.
 * Абзацы звучат по очереди, с паузой между ними: один кусок синтеза не склеивает их в одну скороговорку.
 */
import { BANK, type Card, type TurnN } from './bank';
import { templateUnits } from './lines';
import { timeAt, type Decision, type ModelView } from './session';
import { FRONT_NAMES } from './scenes';
import type { FrontId } from './settings';

const VOICE: Record<string, string> = { su_1bf: 'zhukov-14s', su_1uf: 'konev-12s' };

const spoken = (note: string) => note.replace(/сут(?![\p{L}])/gu, 'суток');

/** Суть решения: первые строки карточки, без «риска» и «расчёта». */
function gist(c: Card | undefined): string {
  const lines = (c?.lines ?? []).filter((l) => !/^Риск:|^Расчёт:/.test(l)).slice(0, 3);
  if (!lines.length) return c?.title ?? '';
  return lines.join('. ').replace(/\.\s*$/, '');
}

/** Что вышло на переломе — как ход операции, от обстановки, а не «я решил иначе». */
function turnStory(front: FrontId, d: Decision): string {
  const turn = BANK.fronts[front]?.turns.find((t) => t.n === d.n);
  const sit = turn?.situation ?? '';
  const card = d.choice === 'delay' ? undefined : BANK.cards.find((c) => c.id === d.choice);
  const hist = BANK.cards.find((c) => c.id === d.historical);
  const done = d.choice === 'delay'
    ? 'Нового приказа не отдали: армии остались на достигнутом и ждали следующего решения.'
    : `${gist(card)}.`;
  const aside = d.choice !== d.historical && hist ? ` В истории на этом участке вышло иначе: ${gist(hist)}.` : '';
  return [sit, done].filter(Boolean).join(' ') + aside;
}

/** С чего командующий начинает разбор: что сейчас будет, а не сразу частность перелома. */
function opening(v: ModelView): string {
  return `Операция ${FRONT_NAMES[v.front]} закончена. Разбираю, как она прошла по вашим приказам: что стояло перед войсками и чем каждый перелом закончился.`;
}

function outcome(v: ModelView): string {
  const f = v.final!;
  const head = f.forecast.replace(' — ', ', ');
  const sentence = head ? `${head[0].toUpperCase()}${head.slice(1)}.` : '';
  return [
    sentence,
    `По темпу ${spoken(f.scales.notes.speed)}.`,
    `По цене операции ${spoken(f.scales.notes.cost)}.`,
    `Замысел: ${f.scales.notes.intent}.`,
    `По такому ходу звание — ${f.rank}.`,
  ].filter(Boolean).join(' ');
}

/** Заголовок прогноза и сравнение с историей. Тире внутри скобок («в истории — 2 мая») не режется. */
export function forecastParts(forecast: string): { head: string; deck: string } {
  const cut = forecast.match(/^(.*?) — ([^()]*)\s*$/);
  return cut ? { head: cut[1], deck: cut[2] } : { head: forecast, deck: '' };
}

/** Предложения разбора по отдельности: каждое звучит своим куском, с паузой после. Сокращения армий не режутся. */
export function debriefSentences(paragraphs: string[]): string[] {
  return paragraphs.flatMap((p) => templateUnits(p));
}

const START = '1945-04-16T05:00';

/** Куда смотрит итог вместе с речью: вступление, перелом или общий исход. */
export interface ResultBeat {
  phase: 'open' | 'turn' | 'close';
  turn: TurnN | null;
  /** Момент карты: начало операции, конец рассказанного перелома или конец хода. */
  until: string;
}

/** Конец хода перелома — час следующего; у последнего — конец операции. */
function turnEnd(front: FrontId, n: TurnN, end: string): string {
  const turns = BANK.fronts[front].turns;
  const next = turns[turns.findIndex((t) => t.n === n) + 1];
  return next ? timeAt(START, next.hour) : end;
}

/**
 * Какой кусок разбора сейчас звучит. Нет фразы — вступление.
 * Фраза не из разбора (короткая заготовка) — общий исход, карта на всём пути.
 */
export function resultBeat(v: ModelView, spoken: string | null): ResultBeat {
  const d = operationDebrief(v);
  const end = v.time || START;
  const open = (): ResultBeat => ({ phase: 'open', turn: null, until: START });
  const close = (): ResultBeat => ({ phase: 'close', turn: null, until: end });
  if (!d) return close();
  if (!spoken) return open();
  const loc = d.paragraphs.flatMap((p, i) => templateUnits(p).map((s) => ({ s, i }))).find((x) => x.s === spoken);
  if (!loc) return close();
  if (loc.i === 0) return open();
  if (loc.i >= d.paragraphs.length - 1) return close();
  const turn = v.decisions[loc.i - 1]?.n ?? null;
  return turn ? { phase: 'turn', turn, until: turnEnd(v.front, turn, end) } : close();
}

/** Рассказ о проведённой операции с точки зрения получившейся обстановки. Пусто — итога ещё нет. */
export function operationDebrief(v: ModelView): { paragraphs: string[]; voice: string } | null {
  const f = v.final;
  if (!f) return null;
  const paragraphs = [
    opening(v),
    ...v.decisions.map((d) => turnStory(v.front, d)),
    outcome(v),
  ].map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!paragraphs.length) return null;
  return { paragraphs, voice: VOICE[v.front] ?? 'zhukov-14s' };
}
