/**
 * Сеанс модели выставочного режима: Берлинская операция в ядре, режим «История как замысел» (противник — тоже по
 * истории), фронт посетителя — с истории с первого перелома.
 *
 * Решение на переломе: историческая карточка — фронт идёт по истории (распоряжений нет); своя — распоряжения армиям
 * фронта на объекты театра; промедление — фронт взят у истории (`game_take`), новых задач армии не получают и
 * закрепляются на достигнутом до следующего перелома. Перед новым решением всё взятое прежним возвращается истории (`game_release`).
 * Прокрутка — ход ядра до следующего перелома; после третьего — досчёт до конца операции и итог по осям.
 */
import { agentsEvents, lossSeries, type AgentHistory, type AgentTrace, type EventResult, type History, type SimContext } from '@def-ops/sim';
import { deal, replacement, type Bank, type Card, type CardFact, type TurnN } from './bank';
import { axes, axisNote, feedLines, forecast, rankOf, type AxesDetail } from './score';
import type { FrontId } from './settings';
import { cardArrows, historyAt, MAP, traceArmies, type Arrow, type ArmyPos, type LL } from './map';

export type CoreCall = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
export interface ModelEnv {
  call: CoreCall;
  ctx: SimContext;
  history: AgentHistory;
  baseHistory: History | null;
  /** Центр объекта театра. */
  placeAt: (place: string) => [number, number] | null;
  /** События и потери фронта по ходу; нет — `agentsEvents` и `lossSeries` по контексту. */
  measure?: (t: AgentTrace, front: FrontId) => { events: EventResult[]; loss: number };
}

/** События операции и потери фронта (личный состав) по ходу до последнего кадра. */
export function measureTrace(env: ModelEnv, t: AgentTrace, front: FrontId) {
  if (env.measure) return env.measure(t, front);
  const upTo = t.frames.length - 1;
  return {
    events: agentsEvents(env.ctx, t, env.history, env.baseHistory),
    loss: lossSeries(t, upTo).rows.find((r) => r.id === front)?.total.personnel ?? 0,
  };
}

/** source: 'now' — карточка составлена ИИ во время сеанса, 'bank' — замена из банка. */
export interface CardView { id: string; title: string; lines: string[]; source?: 'now' | 'bank' | 'prepared'; arrows?: Arrow[]; fact?: CardFact; risk?: string; army?: string }
/** Карта хода: армии сейчас и до прокрутки, новые события с точкой, путь армий фронта по переломам. */
export interface MapView {
  armies: ArmyPos[];
  prev: { armies: ArmyPos[]; time: string } | null;
  flashes: { id: string; title: string; at: LL }[];
  path: Record<string, LL[]>;
}
export interface Decision { n: TurnN; choice: string | 'delay'; historical: string }
export interface Scales { axes: AxesDetail; notes: { speed: string; cost: string; intent: string } }
export interface ModelView {
  front: FrontId;
  turn: TurnN;
  /** Время хода (ISO, минуты) и час от начала операции. */
  time: string;
  hour: number;
  cards: CardView[];
  decisions: Decision[];
  /** Раскрытие последнего решения: «Именно так поступил Жуков» / «Жуков решил иначе — вот как». */
  reveal: { text: string; historical: CardView } | null;
  scales: Scales;
  /** Строки хода операции (события расчёта), новые в конце. */
  feed: string[];
  final: { scales: Scales; rank: string; matches: number; forecast: string } | null;
  map: MapView;
  busy: boolean;
  error: string | null;
}

type Trace = AgentTrace & { game?: { hour: number } };

const view = (c: Card, source?: CardView['source']): CardView => {
  const s = c.prepared === 'ai' ? 'prepared' : source;
  const army = c.fact?.army ?? c.orders[0]?.army;
  return { id: c.id, title: c.title, lines: c.lines, ...(s ? { source: s } : {}), ...(c.fact ? { fact: c.fact } : {}), ...(c.risk ? { risk: c.risk } : {}), ...(army ? { army } : {}) };
};

export function timeAt(start: string, hour: number): string {
  return new Date(Date.parse(`${start.slice(0, 16)}:00Z`) + hour * 3_600_000).toISOString().slice(0, 16);
}

/** Эталон потерь на час: линейно между сутками (на час 0 — ноль). */
export function refAt(losses: number[] | undefined, hour: number): number | null {
  if (!losses?.length) return null;
  const x = hour / 24;
  const i = Math.min(losses.length - 1, Math.floor(x));
  const j = Math.min(losses.length - 1, i + 1);
  return losses[i] + (losses[j] - losses[i]) * (x - i);
}

export class ExpoSession {
  private trace: Trace | null = null;
  private events: EventResult[] = [];
  private shown: string[] = [];
  private returned: string[] = [];
  /** Карточки ИИ этого сеанса. */
  private extra: Card[] = [];
  readonly view: ModelView;
  /** Последний ход ядра (для проверок и эталона). */
  get lastTrace(): AgentTrace | null { return this.trace; }

  constructor(
    private env: ModelEnv,
    private bank: Bank,
    readonly front: FrontId,
    private rnd: () => number = Math.random,
  ) {
    const start = this.start0();
    this.view = {
      front, turn: 1, time: start, hour: 0, cards: [], decisions: [], reveal: null, feed: [], final: null, busy: false, error: null,
      map: { armies: historyAt(start), prev: null, flashes: [], path: {} },
      scales: this.scales([], start, 0),
    };
  }

  private start0() { return (this.trace?.start ?? this.env.ctx.scenario.start).slice(0, 16); }
  private get def() { return this.bank.fronts[this.front]; }
  private card(id: string) { return (this.bank.cards.find((c) => c.id === id) ?? this.extra.find((c) => c.id === id))!; }

  private scales(events: EventResult[], time: string, hour: number, loss = 0): Scales {
    const a = axes(events, this.def.keyEvents, time, loss, refAt(this.bank.reference[this.front]?.losses, hour));
    return { axes: a, notes: { speed: axisNote('speed', a), cost: axisNote('cost', a), intent: axisNote('intent', a) } };
  }

  async start() {
    const sc = this.bank.scenario;
    this.trace = (await this.env.call('game_start', { scenario: sc, seed: 1, takeover: 0, player: 'su', enemy: 'intent', mode: 'intent' })) as Trace;
    const armies = this.armiesNow(this.start0());
    this.view.map = { armies, prev: null, flashes: [], path: this.extend({}, armies) };
  }

  /** Армии по последнему кадру ядра; армии без дивизий в кадре — по истории на это время. */
  private armiesNow(time: string): ArmyPos[] {
    const own = this.trace?.divisions ? traceArmies(this.trace) : [];
    return historyAt(time).map((h) => own.find((a) => a.id === h.id) ?? h);
  }

  private extend(path: Record<string, LL[]>, armies: ArmyPos[]) {
    const next = { ...path };
    for (const a of armies.filter((x) => x.front === this.front)) next[a.id] = [...(next[a.id] ?? []), a.at];
    return next;
  }

  /** Стрелки карточки: распоряжения — к объектам театра; историческая — куда армии фронта дошли по истории к следующему перелому. */
  private arrows(c: Card): Arrow[] {
    const armies = this.view.map.armies;
    if (!c.historical) return cardArrows(c.orders, armies, this.env.placeAt);
    const t = this.def.turns.find((x) => x.n === c.turn);
    const next = this.def.turns.find((x) => x.n === c.turn + 1)?.hour ?? this.bank.end;
    if (!t) return [];
    const to = historyAt(timeAt(this.start0(), next));
    return armies.flatMap((a) => {
      const b = to.find((x) => x.id === a.id);
      return a.front === this.front && b && Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]) > 0.05 ? [{ army: a.id, from: a.at, to: b.at, kind: 'attack' }] : [];
    });
  }

  private show(c: Card, source?: CardView['source']): CardView {
    return { ...view(c, source), arrows: this.arrows(c) };
  }

  /** Раздать карточки перелома n (ход модели должен стоять на его часе). */
  deal(n: TurnN) {
    const ids = deal(this.bank, this.front, n, this.rnd);
    this.shown = [...ids];
    Object.assign(this.view, { turn: n, cards: ids.map((id) => this.show(this.card(id))), reveal: null });
  }

  /** Заменить карточку в слоте; false — заменить нечем (или историческая). */
  replace(slot: number, ai?: Card | null): boolean {
    const cur = this.view.cards[slot];
    if (!cur || this.card(cur.id)?.historical) return false;
    if (ai) this.extra.push(ai);
    const r = ai?.id ?? replacement(this.bank, this.shown, cur.id, this.rnd);
    if (!r) return false;
    this.shown.push(r);
    this.view.cards = this.view.cards.map((c, i) => (i === slot ? this.show(this.card(r), ai ? 'now' : 'bank') : c));
    return true;
  }

  /** В слоте — историческая карточка (её не заменяют). */
  isHistorical(slot: number) { const c = this.view.cards[slot]; return !c || !!this.card(c.id)?.historical; }

  /** Что знает ИИ для карточки перелома: армии фронта, объекты театра из банка фронта, показанные варианты. */
  cardContext(n: TurnN) {
    const t = this.def.turns.find((x) => x.n === n)!;
    const armies = (this.trace?.hqs ?? []).filter((h) => h.parent === this.front && h.echelon === 'army').map((h) => h.id);
    const own = this.bank.cards.filter((c) => c.front === this.front);
    return {
      front: this.front, frontName: this.def.name, marshal: this.def.marshal, n, turnTitle: t.title, situation: t.situation,
      armies: armies.length ? armies : [...new Set(own.flatMap((c) => c.orders.map((o) => o.army)))],
      places: [...new Set(own.flatMap((c) => c.orders.map((o) => o.place)).filter((p): p is string => !!p))],
      shownTitles: this.view.cards.map((c) => c.title),
    };
  }

  /** Решение на переломе n: слот карточки или промедление; прокрутка до следующего перелома (после третьего — до конца). */
  async decide(n: TurnN, choice: number | 'delay') {
    if (!this.trace) throw new Error('сеанс модели не начат');
    const turns = this.def.turns;
    const hist = this.bank.cards.find((c) => c.front === this.front && c.turn === n && c.historical)!;
    const picked = choice === 'delay' ? null : this.card(this.view.cards[choice]?.id ?? hist.id);
    this.view.busy = true;
    try {
      for (const id of this.returned.splice(0)) await this.env.call('game_release', { id });
      const orders = [];
      if (picked === null) {
        // армии без распоряжений фронта закрепляются на достигнутом: их исторические замыслы не наступают
        await this.env.call('game_take', { hq: this.front });
        this.returned.push(this.front);
        for (const h of this.trace.hqs.filter((x) => x.parent === this.front && x.echelon === 'army')) {
          orders.push({ hq: h.id, kind: 'hold', target: null, note: 'промедление: распоряжений фронта нет', form: 'order' });
          this.returned.push(h.id);
        }
      } else {
        for (const o of picked.orders) {
          orders.push({ hq: o.army, kind: o.kind, target: o.place === null ? null : this.env.placeAt(o.place), note: picked.title, form: 'order' });
          this.returned.push(o.army);
        }
      }
      const hour = this.trace.frames.length - 1;
      const to = n < 3 ? turns[n].hour : this.bank.end;
      const before = this.events;
      this.trace = (await this.env.call('game_turn', { orders, hours: Math.max(1, to - hour) })) as Trace;
      const upTo = this.trace.frames.length - 1;
      const { events, loss } = measureTrace(this.env, this.trace, this.front);
      this.events = events;
      const time = timeAt(this.start0(), upTo);
      const m = this.def.marshal;
      const decision: Decision = { n, choice: picked?.id ?? 'delay', historical: hist.id };
      const was = new Set(before.filter((e) => e.simulated).map((e) => e.id));
      const armies = this.armiesNow(time);
      const histView = this.show(hist);
      Object.assign(this.view, {
        time, hour: upTo,
        decisions: [...this.view.decisions, decision],
        reveal: {
          text: picked?.historical ? `Именно так поступил ${m}` : picked ? `${m} решил иначе — вот как` : `Промедление: новых распоряжений нет. ${m} решил так`,
          historical: histView,
        },
        map: {
          armies,
          prev: { armies: this.view.map.armies, time: this.view.time },
          flashes: this.events.filter((e) => e.simulated && !was.has(e.id)).flatMap((e) => MAP.events.filter((m) => m.id === e.id).map((m) => ({ id: e.id, title: e.title, at: m.at }))),
          path: this.extend(this.view.map.path, armies),
        },
        feed: [...this.view.feed, ...feedLines(before, this.events)],
        scales: this.scales(this.events, time, upTo, loss),
      });
      if (n === 3) {
        const s = this.view.scales;
        this.view.final = {
          scales: s, rank: rankOf(s.axes),
          matches: this.view.decisions.filter((d) => d.choice === d.historical).length,
          forecast: forecast(this.events, this.bank.berlinEvent),
        };
      }
      this.view.error = null;
    } catch (e) {
      this.view.error = String((e as Error)?.message ?? e);
      throw e;
    } finally {
      this.view.busy = false;
    }
  }
}
