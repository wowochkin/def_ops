/**
 * Банк карточек выставочного сеанса: переломы фронтов и карточки решений (авторские — этап 2; ИИ-часть — этап 3).
 *
 * Карточка — заголовок, 4–5 коротких строк и распоряжения армиям своего фронта на объекты театра; историческая
 * карточка распоряжений не несёт: фронт идёт по истории («История как замысел»). На переломе посетитель видит
 * историческую и две случайные карточки в случайном порядке; замена берёт свою карточку перелома, которой нет на экране и которую ещё не показывали.
 */
import bankJson from './bank-data/berlin-1945.cards.json';
import { PICTURES } from './pictures';
import type { FrontId } from './settings';

export type TurnN = 1 | 2 | 3;
export type OrderKind = 'attack' | 'defend' | 'hold' | 'withdraw' | 'move';

export interface CardOrder { army: string; kind: OrderKind; place: string | null }
export interface Card {
  id: string;
  front: FrontId;
  turn: TurnN;
  historical?: boolean;
  /** Карточку составила языковая модель при подготовке (отобрана автопроверкой). */
  prepared?: 'ai';
  title: string;
  lines: string[];
  orders: CardOrder[];
  basis: { source: string } | { assumption: string };
  /** Цифра-факт на лицевой стороне: значение, пояснение, армия, о которой факт (её знак на карточке), источник. */
  fact?: CardFact;
  /** Риск решения одной строкой. */
  risk?: string;
  /** Файл снимка из манифеста картинок. Нет подходящего кадра — поля нет. */
  photo?: string;
}
export interface CardFact { value: string; text: string; army: string; source: string }
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

export const PLACE_TITLE: Record<string, string> = {
  Wriezen: 'Врицен', Fuerstenwalde: 'Фюрстенвальде', Frankfurt: 'Франкфурт-на-Одере', Nauen: 'Науэн', Potsdam: 'Потсдам',
  Storkow: 'Шторков', Beeskow: 'Бесков', Halbe: 'Хальбе', B_Tempelhof: 'Темпельхоф', B_Spandau: 'Шпандау', B_Charlottenburg: 'Шарлоттенбург',
  Ketzin: 'Кетцин', Cottbus: 'Котбус', Kamenz: 'Каменц', Bautzen: 'Бауцен', Wittenberg: 'Виттенберг', Torgau: 'Торгау',
  Zossen: 'Цоссен', Luebben: 'Люббен', Luckau: 'Люккау',
};

/** Точки пунктов для стрелок «своего направления» — те же, что города карты, плюс объекты без подписи на листе. */
export const PLACE_AT: Record<string, [number, number]> = {
  Wriezen: [14.133, 52.717], Fuerstenwalde: [14.068, 52.36], Frankfurt: [14.55, 52.341], Nauen: [12.873, 52.605],
  Potsdam: [13.059, 52.401], Storkow: [13.93, 52.255], Beeskow: [14.246, 52.172], Halbe: [13.7, 52.107],
  B_Tempelhof: [13.386, 52.474], B_Spandau: [13.2, 52.536], B_Charlottenburg: [13.304, 52.517], Ketzin: [12.845, 52.478],
  Cottbus: [14.336, 51.757], Kamenz: [14.094, 51.272], Bautzen: [14.424, 51.181], Wittenberg: [12.644, 51.866],
  Torgau: [12.993, 51.538], Zossen: [13.449, 52.216], Luebben: [13.898, 51.938], Luckau: [13.715, 51.852],
};

export const placeAt = (id: string): [number, number] | null => PLACE_AT[id] ?? null;

export const placeTitle = (id: string) => PLACE_TITLE[id] ?? id;

/** Пункты, куда фронт может направить удар сам, без карточки. */
export function aimPlaces(bank: Bank, front: FrontId): { id: string; title: string }[] {
  const ids = [...new Set(bank.cards.filter((c) => c.front === front).flatMap((c) => c.orders.map((o) => o.place).filter((p): p is string => !!p)))];
  return ids.map((id) => ({ id, title: placeTitle(id) })).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

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
    for (const c of bank.cards.filter((x) => x.front === front)) {
      out.push(...cardErrors(c, armies, places));
      // у авторских карточек лицевая сторона полная: факт с источником и риск (у подготовленных ИИ — по возможности)
      if (!c.prepared && !c.fact) out.push(`${c.id}: нет цифры-факта`);
      if (!c.prepared && !c.risk) out.push(`${c.id}: нет риска`);
    }
    for (const t of f.turns) {
      const photos = turnCards(bank, front, t.n).map((c) => c.photo).filter((p): p is string => !!p);
      if (new Set(photos).size !== photos.length) out.push(`${front} перелом ${t.n}: снимок повторяется`);
    }
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
  if (c.fact) {
    if (!/\d/.test(c.fact.value) || c.fact.value.length > 8) out.push(`${c.id}: факт — число до 8 знаков`);
    if (!c.fact.text?.trim() || c.fact.text.length > 44) out.push(`${c.id}: пояснение факта — до 44 знаков`);
    if (!c.fact.source?.trim()) out.push(`${c.id}: у факта нет источника`);
    if (!armies.has(c.fact.army)) out.push(`${c.id}: факт о ${c.fact.army} — не армии фронта ${c.front}`);
  }
  if (c.risk !== undefined && (!c.risk.trim() || c.risk.length > 34)) out.push(`${c.id}: риск — одна строка до 34 знаков`);
  if (c.photo && !PICTURES.some((p) => p.file === c.photo)) out.push(`${c.id}: нет снимка ${c.photo}`);
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

/**
 * Замена карточки в слоте: своя карточка этого перелома, которой сейчас нет на экране.
 * Историческую не заменяем. Карточку, уже сходившую с экрана, можно вернуть.
 */
export function replacement(bank: Bank, _shown: string[], slotCard: string, rnd: () => number = Math.random, onScreen: string[] = _shown, extra: Card[] = []): string | null {
  const c = bank.cards.find((x) => x.id === slotCard) ?? extra.find((x) => x.id === slotCard);
  if (!c || c.historical) return null;
  const fresh = spares(bank, c.front, c.turn, onScreen, extra);
  return fresh.length ? fresh[Math.floor(rnd() * fresh.length)].id : null;
}

/** Свои карточки перелома (банк и карточки ИИ сеанса), которых нет на экране, — чем заменить. */
export function spares(bank: Bank, front: FrontId, n: TurnN, onScreen: string[], extra: Card[] = []): Card[] {
  return [...turnCards(bank, front, n), ...extra.filter((x) => x.front === front && x.turn === n)].filter((x) => !x.historical && !onScreen.includes(x.id));
}
