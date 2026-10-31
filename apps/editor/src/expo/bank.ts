/**
 * Банк карточек выставочного сеанса: переломы фронтов и карточки решений (авторские — этап 2; ИИ-часть — этап 3).
 *
 * Карточка — заголовок, 4–5 коротких строк и распоряжения армиям своего фронта на объекты театра; историческая
 * карточка распоряжений не несёт: фронт идёт по истории («История как замысел»). На переломе посетитель видит
 * историческую и две случайные карточки в случайном порядке; замена берёт ещё не показанную карточку перелома.
 */
import bankJson from './bank-data/berlin-1945.cards.json';
import type { FrontId } from './settings';

export type TurnN = 1 | 2 | 3;
export type OrderKind = 'attack' | 'defend' | 'hold' | 'withdraw' | 'move';

export interface CardOrder { army: string; kind: OrderKind; place: string | null }
export interface Card {
  id: string;
  front: FrontId;
  turn: TurnN;
  historical?: boolean;
  title: string;
  lines: string[];
  orders: CardOrder[];
  basis: { source: string } | { assumption: string };
}
export interface TurnDef { n: TurnN; hour: number; title: string; situation: string }
export interface FrontDef { name: string; marshal: string; keyEvents: string[]; turns: TurnDef[] }
/** Эталон по истории: потери фронта (личный состав) нарастающим итогом по суткам. */
export interface Reference { losses: number[] }
export interface Bank {
  scenario: string;
  history: string;
  context: string;
  end: number;
  berlinEvent: string;
  fronts: Record<FrontId, FrontDef>;
  cards: Card[];
  reference: Partial<Record<FrontId, Reference>>;
}

export const BANK = bankJson as unknown as Bank;

export const turnCards = (bank: Bank, front: FrontId, n: TurnN) => bank.cards.filter((c) => c.front === front && c.turn === n);

/** Ошибки формы банка: армии — только своего фронта, цели — объекты театра, текст — в пределах карточки. */
export function bankErrors(bank: Bank, armiesOf: (front: FrontId) => string[], places: Set<string>): string[] {
  const out: string[] = [];
  for (const [front, f] of Object.entries(bank.fronts) as [FrontId, FrontDef][]) {
    const armies = new Set(armiesOf(front));
    for (const t of f.turns) {
      const cs = turnCards(bank, front, t.n);
      if (cs.filter((c) => c.historical).length !== 1) out.push(`${front} перелом ${t.n}: нужна одна историческая карточка`);
      if (cs.filter((c) => !c.historical).length < 3) out.push(`${front} перелом ${t.n}: меньше трёх своих карточек`);
    }
    for (const c of bank.cards.filter((x) => x.front === front)) out.push(...cardErrors(c, armies, places));
  }
  return out;
}

const KINDS: OrderKind[] = ['attack', 'defend', 'hold', 'withdraw', 'move'];

/** Ошибки формы одной карточки (банк и карточки ИИ): армии своего фронта, объекты театра, текст в пределах карточки. */
export function cardErrors(c: Card, armies: Set<string>, places: Set<string>): string[] {
  const out: string[] = [];
  if (c.historical && c.orders.length) out.push(`${c.id}: у исторической карточки нет распоряжений`);
  if (!c.historical && !c.orders.length) out.push(`${c.id}: нет распоряжений`);
  if (!c.title?.trim()) out.push(`${c.id}: нет заголовка`);
  if (!Array.isArray(c.lines) || c.lines.length < 4 || c.lines.length > 5) out.push(`${c.id}: строк должно быть 4–5`);
  for (const l of [c.title ?? '', ...(c.lines ?? [])]) if (l.length > 60) out.push(`${c.id}: строка длиннее 60 знаков — «${l}»`);
  for (const o of c.orders ?? []) {
    if (!KINDS.includes(o.kind)) out.push(`${c.id}: неизвестное распоряжение ${o.kind}`);
    if (!armies.has(o.army)) out.push(`${c.id}: ${o.army} — не армия фронта ${c.front}`);
    if (o.place !== null && !places.has(o.place)) out.push(`${c.id}: ${o.place} — нет среди объектов театра`);
    if (o.place === null && o.kind !== 'hold' && o.kind !== 'defend') out.push(`${c.id}: ${o.kind} без цели`);
  }
  return out;
}

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Три карточки перелома: историческая и две случайные, порядок перемешан. */
export function deal(bank: Bank, front: FrontId, n: TurnN, rnd: () => number = Math.random): string[] {
  const cs = turnCards(bank, front, n);
  const hist = cs.find((c) => c.historical)!;
  const own = shuffle(cs.filter((c) => !c.historical), rnd).slice(0, 2);
  return shuffle([hist, ...own], rnd).map((c) => c.id);
}

/** Замена карточки в слоте: ещё не показанная своя карточка перелома; историческую не заменяем, замен нет — null. */
export function replacement(bank: Bank, shown: string[], slotCard: string, rnd: () => number = Math.random): string | null {
  const c = bank.cards.find((x) => x.id === slotCard);
  if (!c || c.historical) return null;
  const free = turnCards(bank, c.front, c.turn).filter((x) => !x.historical && !shown.includes(x.id));
  return free.length ? free[Math.floor(rnd() * free.length)].id : null;
}
