/**
 * Командование по ступеням в игре на агентной модели: как называется документ игрока (верхней инстанции) по
 * ступени получателя и форме, пометки управления штабов, режимы игры. Без React — проверяется в node.
 */
import type { CommandOp, GameMode } from '@def-ops/sim';
import type { TurnView } from './sim/game-protocol';

export type { CommandOp };

export type Form = 'order' | 'instruction';

/** Получатель ниже фронта (группы армий) — приказ через голову (ПУ-39 ст. 93): пропущенные штабы получают извещение. */
export const overHead = (echelon: string): boolean => echelon !== 'front';

/**
 * Документ верхней инстанции: директива (приказ — подготовленный, сутки на ступень) или боевое распоряжение
 * (быстро, 1–3 ч на ступень, слаженность ниже); немецкая сторона — Weisung / Einzelbefehl ОКХ.
 */
export function formTitle(side: 'su' | 'de' | string, echelon: string, form: Form): string {
  const head = side === 'de'
    ? (form === 'order' ? 'Weisung (директива ОКХ)' : 'Einzelbefehl (частный приказ ОКХ)')
    : (form === 'order' ? 'директива Ставки' : 'боевое распоряжение Ставки');
  return overHead(echelon) ? `${head} — через голову${side === 'de' ? '' : ' (ПУ-39 ст. 93)'}` : head;
}

/** Пометка штаба или дивизии: взят игроком, ведёт Ставка (через голову), по сценарию («гибрид»); у агента — нет. */
export function controlMark(c: { control: string; led: boolean } | undefined): { text: string; cls: string } | null {
  if (!c) return null;
  if (c.control === 'player') return { text: 'взят под управление', cls: 'ctl-player' };
  if (c.led) return { text: 'ведёт Ставка', cls: 'ctl-led' };
  if (c.control === 'script') return { text: 'по сценарию (гибрид)', cls: 'ctl-script' };
  return null;
}

/** Режимы игры на агентной модели. */
export const MODE_TITLE: Record<GameMode, { title: string; hint: string }> = {
  legacy: { title: 'Как сейчас', hint: 'приказ штабу доходит до каждой его дивизии; собственные штабы стороны не решают' },
  agents: { title: 'Штабы-агенты', hint: 'вы — Ставка: директивы фронтам, ниже решают штабы-агенты по уставам; можно приказать через голову и взять штаб под управление' },
  hybrid: { title: 'Гибрид', hint: 'как «штабы-агенты», но поданные без изменений исторические директивы ведут приказы сценария — ближе к истории' },
};


const subject = (c: CommandOp) => (c.op === 'take' ? c.hq : c.op === 'release' ? c.id : c.op === 'permit' ? c.hq : c.id);
/**
 * Команда в очередь хода: повтор не добавляется; «взять» и «вернуть» одного штаба в одном ходе гасят друг друга;
 * ответ на запросы штаба — последний.
 */
export function queueOp(q: CommandOp[], op: CommandOp): CommandOp[] {
  const same = (c: CommandOp) => c.op === op.op && subject(c) === subject(op);
  const opposite = (c: CommandOp) => subject(c) === subject(op) && ((c.op === 'take' && op.op === 'release') || (c.op === 'release' && op.op === 'take'));
  if (q.some(opposite)) return q.filter((c) => !opposite(c));
  if (op.op === 'permit') return [...q.filter((c) => !same(c)), op];
  return q.some(same) ? q : [...q, op];
}

/** Слова названия: числа без окончаний («8-я» → «8»), слова — по первым четырём буквам. */
const words = (s: string) => s.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean).filter((w) => !/^(я|й|го|ая|ую)$/.test(w)).map((w) => (/^\d/.test(w) ? w.replace(/\D+$/, '') : w.slice(0, 4)));
/** Штаб по id или названию (все слова запроса есть в названии); нет — null. */
export function findHq(hqs: Record<string, { name: string }>, q: string): string | null {
  if (hqs[q]) return q;
  const want = words(q);
  if (!want.length) return null;
  return Object.entries(hqs).find(([, h]) => { const have = words(h.name); return want.every((w) => have.includes(w)); })?.[0] ?? null;
}

/**
 * Очередь команд на первый ход: в режиме «штабы-агенты» — исторические директивы, час которых уже наступил (при
 * передаче командования они уже действуют); в «гибриде» — все (подаются только до первого хода). Не первый ход — пусто.
 */
export function initialCmds(v: TurnView): CommandOp[] {
  const c = v.command;
  if (!c || c.mode === 'legacy' || v.turn !== 1) return [];
  return c.historical.filter((h) => !h.issued && (c.mode === 'hybrid' || h.due)).map((h) => ({ op: 'historical', id: h.id }));
}

/** Пометка своего штаба или дивизии в докладах; «как сейчас» (и старые записи игры) — без пометок. */
export function markFor(v: TurnView, id: string): { text: string; cls: string } | null {
  const c = v.command;
  if (!c || c.mode === 'legacy') return null;
  return controlMark(c.hqs[id] ?? (c.led.includes(id) ? { control: 'agent', led: true } : undefined));
}
