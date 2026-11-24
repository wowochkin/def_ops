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
import { baselineAt, rebaseEvents } from './baseline';
import { deal, placeAt as pointAt, placeTitle, replacement, spares, type Bank, type Card, type CardFact, type TurnN } from './bank';
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
export interface CardView { id: string; title: string; lines: string[]; source?: 'now' | 'bank' | 'prepared'; arrows?: Arrow[]; fact?: CardFact; risk?: string; army?: string; photo?: string }
/** Карта хода: армии сейчас и до прокрутки, новые события с точкой, путь армий фронта по переломам. */
export interface MapView {
  armies: ArmyPos[];
  prev: { armies: ArmyPos[]; time: string } | null;
  flashes: { id: string; title: string; at: LL }[];
  path: Record<string, LL[]>;
}
export interface Decision { n: TurnN; choice: string | 'delay'; historical: string }
export interface Scales { axes: AxesDetail; notes: { speed: string; cost: string; intent: string } }
/** Задача фронта — ключевое событие. `historical` — дата календаря; `due` — с какого дня оно уже должно было случиться в базе. */
export interface Task { id: string; title: string; historical: string; due: string; simulated: string | null; days: number | null }
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
  /** Сколько своих карточек перелома можно поставить взамен показанных. */
  spare: number;
  /** Задачи фронта по порядку ключевых событий. */
  tasks: Task[];
  /** Потери фронта (личный состав) к часу хода и потери того же фронта «как было» на тот же час. */
  loss: { own: number; ref: number | null };
  /** Ближайшая армия фронта до центра Берлина, км: в ходе и по истории на тот же момент. */
  berlinKm: { now: number; history: number } | null;
  /** Что изменилось за последний ход; null — хода ещё не было. */
  move: MoveDigest | null;
  /** Направление принятого решения на карте. */
  blow: { title: string; arrows: Arrow[] } | null;
  map: MapView;
  busy: boolean;
  error: string | null;
}

type Trace = AgentTrace & { game?: { hour: number } };

const view = (c: Card, source?: CardView['source']): CardView => {
  const s = c.prepared === 'ai' ? 'prepared' : source;
  const army = c.fact?.army ?? c.orders[0]?.army;
  return { id: c.id, title: c.title, lines: c.lines, ...(s ? { source: s } : {}), ...(c.fact ? { fact: c.fact } : {}), ...(c.risk ? { risk: c.risk } : {}), ...(army ? { army } : {}), ...(c.photo ? { photo: c.photo } : {}) };
};

/** Расстояние, км (равнопромежуточно по широте места). */
const km = (a: LL, b: LL) => Math.hypot((a[0] - b[0]) * 111.3 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 111.3);

export interface MoveDigest {
  /** На сколько километров дальше всех сдвинулась армия фронта. */
  advanceKm: number;
  /** На сколько километров ближе к Берлину стала ближайшая армия (отрицательное — дальше). */
  closerKm: number;
  taken: string[];
  crossings: string[];
  enemyKm: number;
  enemy: string;
}

/** Сводка изменений за ход: продвижение, взятые пункты, переправы, сдвиг противника. */
export function moveDigest(front: FrontId, prev: ArmyPos[], now: ArmyPos[], prevBerlin: number | null, berlin: number | null, fresh: { title: string }[]): MoveDigest {
  let advance = 0;
  for (const a of now.filter((x) => x.front === front)) {
    const b = prev.find((x) => x.id === a.id);
    if (b) advance = Math.max(advance, km(a.at, b.at));
  }
  let enemyKm = 0;
  for (const a of now.filter((x) => x.side === 'de')) {
    const b = prev.find((x) => x.id === a.id);
    if (b) enemyKm = Math.max(enemyKm, km(a.at, b.at));
  }
  const crossings = fresh.filter((e) => /форсир|переправ/i.test(e.title)).map((e) => e.title).slice(0, 2);
  const taken = fresh.filter((e) => !crossings.includes(e.title)).map((e) => e.title).slice(0, 4);
  const closer = prevBerlin !== null && berlin !== null ? prevBerlin - berlin : 0;
  const enemy = enemyKm >= 8
    ? `Противник сдвинулся: дальше всех его армия прошла ${Math.round(enemyKm)} км. Замысел противника в этой переигровке — исторический.`
    : 'Противник держит исторический замысел: заметного отхода его армий за ход нет.';
  return { advanceKm: Math.round(advance), closerKm: Math.round(closer), taken, crossings, enemyKm: Math.round(enemyKm), enemy };
}
const BERLIN: LL = MAP.cities.find((c) => c.capital)?.at ?? [13.4, 52.52];

/** До Берлина от ближайшей армии фронта: в ходе (`armies`) и по истории на момент `time`, км. */
export function berlinDistance(front: FrontId, armies: ArmyPos[], time: string): { now: number; history: number } | null {
  const near = (xs: ArmyPos[]) => Math.min(...xs.filter((a) => a.front === front).map((a) => km(a.at, BERLIN)));
  const now = near(armies), history = near(historyAt(time));
  return Number.isFinite(now) && Number.isFinite(history) ? { now: Math.round(now), history: Math.round(history) } : null;
}

/** Задачи фронта по ключевым событиям: из событий хода, без них — по истории (дата и название). */
export function tasksOf(keys: string[], events: EventResult[]): Task[] {
  return keys.map((id) => {
    const e = events.find((x) => x.id === id);
    const h = MAP.events.find((x) => x.id === id);
    const calendar = (h?.date ?? e?.historical ?? '').slice(0, 10);
    const due = (e?.historical ?? h?.date ?? '').slice(0, 10);
    return { id, title: e?.title ?? h?.title ?? id, historical: calendar || due, due: due || calendar, simulated: e?.simulated?.slice(0, 10) ?? null, days: e?.days ?? null };
  });
}

export function timeAt(start: string, hour: number): string {
  return new Date(Date.parse(`${start.slice(0, 16)}:00Z`) + hour * 3_600_000).toISOString().slice(0, 16);
}

const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Исторические решения идут тем же расчётом, что база. Событие, которого в базе к этому дню ещё нет
 * (или база ещё не посчитана), не считается просроченным по календарю 1945 года: иначе шкала цены
 * удваивает совпавшие потери, а скорость получает сутки опоздания за событие, до которого ход не дошёл.
 */
function holdOpen(events: EventResult[], today: string, historical: boolean): EventResult[] {
  if (!historical) return events;
  return events.map((e) => {
    if (e.simulated) return e;
    const at = baselineAt(e.id);
    if (typeof at === 'string' && at <= today) return e;
    if (typeof at === 'string') return { ...e, historical: at };
    if (at === null) return { ...e, historical: '9999-01-01' };
    return { ...e, historical: dayAfter(today) };
  });
}
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
  /** Удары «своего направления»: час решения и пункт. Ядро на следующем ходе затирает кадры историей — марш накладывается заново. */
  private marches: { fromHour: number; until: number | null; target: LL }[] = [];
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
      spare: 0, tasks: tasksOf(this.bank.fronts[front].keyEvents, []), loss: { own: 0, ref: 0 }, berlinKm: berlinDistance(front, historyAt(start), start), move: null, blow: null,
      map: { armies: historyAt(start), prev: null, flashes: [], path: {} },
      scales: this.scales([], start, 0),
    };
  }

  private start0() { return (this.trace?.start ?? this.env.ctx.scenario.start).slice(0, 16); }
  private get def() { return this.bank.fronts[this.front]; }
  private card(id: string) { return (this.bank.cards.find((c) => c.id === id) ?? this.extra.find((c) => c.id === id))!; }

  private scales(events: EventResult[], time: string, hour: number, loss = 0): Scales {
    const a = axes(events, this.def.keyEvents, time, loss, refAt(this.bank.reference[this.front]?.losses, hour), hour >= this.bank.end);
    return { axes: a, notes: { speed: axisNote('speed', a), cost: axisNote('cost', a), intent: axisNote('intent', a) } };
  }

  async start() {
    const sc = this.bank.scenario;
    this.trace = (await this.env.call('game_start', { scenario: sc, seed: 1, takeover: 0, player: 'su', enemy: 'intent', mode: 'intent' })) as Trace;
    const armies = this.armiesNow(this.start0());
    this.view.map = { armies, prev: null, flashes: [], path: this.extend({}, armies) };
    this.view.berlinKm = berlinDistance(this.front, armies, this.start0());
    try {
      // названия и даты задач — из событий операции («как было»), пока своих событий нет
      this.view.tasks = tasksOf(this.def.keyEvents, measureTrace(this.env, this.trace, this.front).events.map((e) => ({ ...e, simulated: null, days: null, at: null })));
    } catch { /* остаются названия по истории */ }
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
    if (!c.historical) return cardArrows(c.orders, armies, id => this.point(id));
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
    this.view.spare = this.spareCount();
  }

  /** Сколько своих карточек перелома можно поставить взамен (их нет на экране). */
  private spareCount() {
    const on = this.view.cards.map((c) => c.id);
    return spares(this.bank, this.front, this.view.turn, on, this.extra).length;
  }

  /** Заменить карточку в слоте; false — заменить нечем (или историческая). */
  replace(slot: number, ai?: Card | null): boolean {
    const cur = this.view.cards[slot];
    if (!cur || this.card(cur.id)?.historical) return false;
    if (ai) this.extra.push(ai);
    const r = ai?.id ?? replacement(this.bank, this.shown, cur.id, this.rnd, this.view.cards.map((c) => c.id), this.extra);
    if (!r) return false;
    if (!this.shown.includes(r)) this.shown.push(r);
    const again = this.extra.find((c) => c.id === r);
    this.view.cards = this.view.cards.map((c, i) => (i === slot ? this.show(this.card(r), ai || again ? 'now' : 'bank') : c));
    this.view.spare = this.spareCount();
    return true;
  }

  /**
   * Показ удара поверх свежего хода ядра. Пока удар последний, дивизии идут к пункту (~30 км в сутки).
   * Противник впереди ближе 18 км не отпускает их ждать: ход падает примерно до 6 км в сутки, пока он там.
   * Со следующего решения они не прыгают на исторические места: дальше сдвигаются на столько же, на сколько
   * сдвинулся расчёт, но от точки, куда дошёл марш.
   */
  private paintMarches() {
    const t = this.trace;
    if (!t || !this.marches.length) return;
    const hq = new Map(t.hqs.map((h) => [h.id, h]));
    const armyOf = (id: string) => {
      for (let h = hq.get(id), i = 0; h && i < 8; h = h.parent ? hq.get(h.parent) : undefined, i++) if (h.echelon === 'army') return h.id;
      return null;
    };
    const ours = new Set(t.hqs.filter((h) => h.echelon === 'army' && h.parent === this.front).map((h) => h.id));
    const end = t.frames.length - 1;
    const perHour = 30 / 24;
    const engine: LL[][] = t.divisions.map((_, i) => t.frames.map((f) => {
      const row = f?.[i];
      return Array.isArray(row) ? [Number(row[0]), Number(row[1])] as LL : [NaN, NaN];
    }));
    const enemy = t.divisions.flatMap((d, i) => ((d as { side?: string }).side === 'de' ? [i] : []));
    const enemyAhead = (at: LL, h: number, target: LL) => enemy.some((k) => {
      const e = engine[k][h];
      if (!e || !Number.isFinite(e[0])) return false;
      const dx = e[0] - at[0];
      const dy = e[1] - at[1];
      if (dx * (target[0] - at[0]) + dy * (target[1] - at[1]) <= 0) return false;
      return km(at, e) < 18;
    });
    t.divisions.forEach((d, i) => {
      const army = armyOf(d.hq);
      if (!army || !ours.has(army)) return;
      const pos = engine[i].map((p) => [p[0], p[1]] as LL);
      for (const m of this.marches) {
        const from = pos[m.fromHour];
        if (!from || !Number.isFinite(from[0])) continue;
        const until = Math.min(end, m.until ?? end);
        const whole = Math.max(km(from, m.target), 1);
        let gone = 0;
        for (let h = m.fromHour + 1; h <= until; h++) {
          const rate = enemyAhead(pos[h - 1], h, m.target) ? perHour * 0.2 : perHour;
          gone += rate;
          const step = Math.min(1, gone / whole);
          pos[h] = [from[0] + (m.target[0] - from[0]) * step, from[1] + (m.target[1] - from[1]) * step];
        }
        const anchor = pos[until];
        const base = engine[i][until];
        if (anchor && base && until < end) {
          for (let h = until + 1; h <= end; h++) {
            const e = engine[i][h];
            if (!e || !Number.isFinite(e[0])) continue;
            pos[h] = [anchor[0] + (e[0] - base[0]), anchor[1] + (e[1] - base[1])];
          }
        }
      }
      for (let h = 0; h <= end; h++) {
        const row = t.frames[h]?.[i];
        const p = pos[h];
        if (!Array.isArray(row) || !p || !Number.isFinite(p[0])) continue;
        row[0] = Math.round(p[0] * 1e4) / 1e4;
        row[1] = Math.round(p[1] * 1e4) / 1e4;
      }
    });
  }

  /** Дивизии этого фронта не дальше `kmMax` от точки. Чужой фронт не считается. */
  private near(at: LL, kmMax: number): boolean {
    const t = this.trace;
    if (!t) return false;
    const hq = new Map(t.hqs.map((h) => [h.id, h]));
    const ours = (id: string) => {
      for (let h = hq.get(id), i = 0; h && i < 8; h = h.parent ? hq.get(h.parent) : undefined, i++) if (h.id === this.front) return true;
      return id === this.front;
    };
    const hour = t.frames.length - 1;
    return t.divisions.some((d, i) => {
      if (!ours(d.hq)) return false;
      const row = t.frames[hour]?.[i];
      return Array.isArray(row) && km([Number(row[0]), Number(row[1])], at) <= kmMax;
    });
  }

  /** Жуков — круг Рейхстага. Конев — выход к Берлину с юга, район Цоссена, а не Рейхстаг. */
  private cityHeld(): boolean {
    return this.near([13.377, 52.516], 14);
  }

  private objectiveMet(): boolean {
    if (this.front === 'su_1uf') return this.near([13.449, 52.216], 25);
    return this.cityHeld();
  }

  /** Точка приказа: сначала пункт стрелки, затем район театра. Без точки приказ «наступать» расчёт отбрасывает. */
  private point(id: string): LL | null {
    return pointAt(id) ?? this.env.placeAt(id);
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
  async decide(n: TurnN, choice: number | 'delay' | { place: string }) {
    if (!this.trace) throw new Error('сеанс модели не начат');
    const turns = this.def.turns;
    const hist = this.bank.cards.find((c) => c.front === this.front && c.turn === n && c.historical)!;
    const aim = typeof choice === 'object' ? choice.place : null;
    const picked = typeof choice === 'number' ? this.card(this.view.cards[choice]?.id ?? hist.id) : null;
    this.view.busy = true;
    try {
      for (const id of this.returned.splice(0)) await this.env.call('game_release', { id });
      const orders = [];
      let blow: ModelView['blow'] = null;
      if (aim) {
        const name = placeTitle(aim);
        const armies = this.trace.hqs.filter((h) => h.parent === this.front && h.echelon === 'army');
        const who = armies;
        // боевое распоряжение, не подготовленный приказ: тот идёт около суток на ступень и за двое суток первого перелома до дивизий не доходит — армии так и стоят. Распоряжение само снимает армию с истории.
        for (const h of who) {
          this.returned.push(h.id);
          const target = this.point(aim);
          if (target) orders.push({ hq: h.id, kind: 'attack', target, note: `удар на ${name}`, form: 'instruction' });
        }
        const from = this.view.map.armies.filter((a) => who.some((h) => h.id === a.id));
        const at = from.length
          ? [from.reduce((s, a) => s + a.at[0], 0) / from.length, from.reduce((s, a) => s + a.at[1], 0) / from.length] as [number, number]
          : null;
        const to = this.point(aim);
        blow = { title: `Удар на ${name}`, arrows: at && to ? [{ army: who[0].id, from: at, to, kind: 'attack' }] : [] };
      } else if (picked === null) {
        // армии без распоряжений фронта закрепляются на достигнутом: их исторические замыслы не наступают
        await this.env.call('game_take', { hq: this.front });
        this.returned.push(this.front);
        for (const h of this.trace.hqs.filter((x) => x.parent === this.front && x.echelon === 'army')) {
          orders.push({ hq: h.id, kind: 'hold', target: null, note: 'промедление: распоряжений фронта нет', form: 'order' });
          this.returned.push(h.id);
        }
      } else {
        for (const o of picked.orders) {
          orders.push({ hq: o.army, kind: o.kind, target: o.place === null ? null : this.point(o.place), note: picked.title, form: 'order' });
          this.returned.push(o.army);
        }
      }
      const hour = this.trace.frames.length - 1;
      const to = n < 3 ? turns[n].hour : this.bank.end;
      const before = this.events;
      for (const m of this.marches) if (m.until === null) m.until = hour;
      if (aim) {
        const target = this.point(aim);
        if (target) this.marches.push({ fromHour: hour, until: null, target });
      }
      this.trace = (await this.env.call('game_turn', { orders, hours: Math.max(1, to - hour) })) as Trace;
      this.paintMarches();
      const upTo = this.trace.frames.length - 1;
      const { events: raw, loss } = measureTrace(this.env, this.trace, this.front);
      const time = timeAt(this.start0(), upTo);
      const events = holdOpen(rebaseEvents(raw), time.slice(0, 10), this.view.decisions.every((d) => d.choice === d.historical) && !!picked?.historical);
      const banner = this.front !== 'su_1bf' || this.cityHeld();
      this.events = banner ? events : events.map((e) => e.id === this.bank.berlinEvent ? { ...e, simulated: null, days: null, at: null } : e);
      if (!banner) this.view.feed = this.view.feed.filter((line) => !/рейхстаг/i.test(line));
      const m = this.def.marshal;
      const decision: Decision = { n, choice: aim ? `aim:${aim}` : picked?.id ?? 'delay', historical: hist.id };
      const was = new Set(before.filter((e) => e.simulated).map((e) => e.id));
      const armies = this.armiesNow(time);
      const histView = this.show(hist);
      const berlin = berlinDistance(this.front, armies, time);
      const fresh = this.events.filter((e) => e.simulated && !was.has(e.id));
      Object.assign(this.view, {
        time, hour: upTo,
        decisions: [...this.view.decisions, decision],
        reveal: {
          text: aim ? `${m} повёл удар на ${placeTitle(aim)}` : picked?.historical ? `Именно так поступил ${m}` : picked ? `${m} решил иначе — вот как` : `Промедление: новых распоряжений нет. ${m} решил так`,
          historical: histView,
        },
        map: {
          armies,
          prev: { armies: this.view.map.armies, time: this.view.time },
          flashes: fresh.flatMap((e) => MAP.events.filter((m) => m.id === e.id).map((m) => ({ id: e.id, title: e.title, at: m.at }))),
          path: this.extend(this.view.map.path, armies),
        },
        feed: [...this.view.feed, ...feedLines(before, this.events)],
        blow,
        scales: this.scales(this.events, time, upTo, loss),
        tasks: tasksOf(this.def.keyEvents, this.events),
        loss: { own: loss, ref: refAt(this.bank.reference[this.front]?.losses, upTo) },
        berlinKm: berlin,
        move: moveDigest(this.front, this.view.map.armies, armies, this.view.berlinKm?.now ?? null, berlin?.now ?? null, fresh),
      });
      if (n === 3) {
        const s = this.view.scales;
        this.view.final = {
          scales: s, rank: rankOf(s.axes, this.objectiveMet()),
          matches: this.view.decisions.filter((d) => d.choice === d.historical).length,
          forecast: this.front === 'su_1uf' && !this.objectiveMet()
            ? 'К концу расчёта фронт не вышел бы к Берлину с юга (в истории — Цоссен)'
            : forecast(this.events, this.bank.berlinEvent),
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
