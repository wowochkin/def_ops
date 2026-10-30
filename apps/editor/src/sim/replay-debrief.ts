/**
 * Разбор хода в «Переигровке»: расчёт агентной модели делится на сутки от начала, по каждым — ключевые события по
 * правилам (turnEvents, те же, что в игре). Переигровку смотрит посредник: видно всё, причины противника тоже;
 * позиция — советская сторона. Считается в фоновом потоке переигровки вместе с итогами.
 */
import { commandTerms, turnEvents, type AgentHistory, type AgentTrace, type CommandTerms, type History, type OperationSummary, type SimContext, type TurnDebrief } from '@def-ops/sim';

export interface ReplayDebriefs { terms: CommandTerms; turns: TurnDebrief[] }

/** Окна по hours часов: (0, h], (h, 2h], …, последнее — до конца хода. */
export function replayWindows(frames: number, hours = 24): { from: number; to: number }[] {
  const last = frames - 1, out: { from: number; to: number }[] = [];
  for (let a = 0; a < last; a += hours) out.push({ from: a, to: Math.min(last, a + hours) });
  return out;
}

export function replayDebriefs(base: SimContext, t: AgentTrace, h: AgentHistory, baseHistory: History | null, hours = 24): ReplayDebriefs {
  const side = 'su' as const;
  return { terms: commandTerms(base, side), turns: replayWindows(t.frames.length, hours).map((w) => turnEvents(base, t, h, baseHistory, w.from, w.to, { side, reveal: true })) };
}

/** Сутки разбора для момента шкалы: окно, в котором лежит время (до первого окна — первое, после конца — последнее). */
export function replayDebriefAt(d: ReplayDebriefs | undefined, time: string | null): number {
  if (!d?.turns.length || !time) return d?.turns.length ? 0 : -1;
  const ms = Date.parse(`${time.slice(0, 16)}Z`);
  const i = d.turns.findIndex((x) => Date.parse(`${x.time}Z`) >= ms);
  return i < 0 ? d.turns.length - 1 : i;
}

/**
 * Ответ «только сводка» (сохранённая переигровка, без вмешательства): сводка — всегда; разбор хода (withDebriefs) —
 * если посчитался, ошибка разбора — в debriefsError, сводку она не отнимает.
 */
export function summaryReply(summary: () => OperationSummary, debriefs: () => ReplayDebriefs, withDebriefs: boolean):
  { kind: 'summary'; summary: OperationSummary; debriefs?: ReplayDebriefs; debriefsError?: string } {
  const s = summary();
  if (!withDebriefs) return { kind: 'summary', summary: s };
  try { return { kind: 'summary', summary: s, debriefs: debriefs() }; }
  catch (e) { console.warn('разбор хода не посчитан:', e); return { kind: 'summary', summary: s, debriefsError: String((e as Error)?.message ?? e) }; }
}
