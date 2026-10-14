/**
 * Карточка соединения на карте переигровки: данные для щелчка по знаку. Нынешняя модель — по снимкам прогона
 * (после каждого хода) и иерархии сценария с переподчинениями на момент; штаб без своих войск (фронт, армия-штаб) —
 * сумма его действующих соединений. Агентная модель — карточка штаба по ходу дивизий (по часам).
 */
import { POSTURE_RU, type AgentTrace, type RunResult, type SimContext } from '@def-ops/sim';

/** Строка снимка: id, люди, танки, положение (posture), уничтожено, отрезано, боеприпасы (бк). */
export type UnitRow = [id: string, personnel: number, tanks: number, posture: string, destroyed: 0 | 1, cutOff: 0 | 1, ammo: number];

/** Что нужно карточкам из прогона нынешней модели: формирования, изменения по датам, снимки (компактно). */
export interface ReplayUnits {
  sides: { id: string; name: string }[];
  formations: {
    id: string; name: string; side: string; echelon: string;
    /** Вышестоящий на начало (до переподчинений). */
    parent: string | null;
    /** Действующее (своя точка на карте, свои силы); иначе — штаб, силы — по подчинённым. */
    acting: boolean;
    /** Исходные силы (с пополнениями за весь прогон: на момент — без будущих). */
    initial: { personnel: number; tanks: number };
  }[];
  /** Переподчинения и пополнения по времени журнала (действуют в снимках позже этого времени). */
  changes: { time: string; formation: string; to?: string; personnel?: number; tanks?: number }[];
  snapshots: { time: string; units: UnitRow[] }[];
}

export const ECHELON_RU: Record<string, string> = { front: 'фронт', army: 'армия', corps: 'корпус', division: 'дивизия', brigade: 'бригада', regiment: 'полк' };
const RANK: Record<string, number> = { regiment: 0, brigade: 1, division: 2, corps: 3, army: 4, front: 5 };

/** Данные карточек из прогона (в фоновом потоке, вместе с картой). */
export function replayUnits(ctx: SimContext, run: RunResult): ReplayUnits {
  const fin = run.final;
  const tree = new Map<string, ReplayUnits['formations'][number]>();
  // первое переподчинение каждого формирования знает прежнего вышестоящего
  const firstFrom = new Map<string, string | null>();
  const changes: ReplayUnits['changes'] = [];
  for (const j of fin.journal) {
    if (j.kind === 'resubordinated') { if (!firstFrom.has(j.formation)) firstFrom.set(j.formation, j.from); changes.push({ time: j.time, formation: j.formation, to: j.to }); }
    else if (j.kind === 'reinforced') changes.push({ time: j.time, formation: j.formation, personnel: j.personnel, tanks: j.tanks });
  }
  for (const f of ctx.scenario.formations) {
    tree.set(f.id, { id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent: f.parent ?? null, acting: !!f.type, initial: { personnel: f.personnel ?? 0, tanks: f.tanks ?? 0 } });
  }
  for (const f of fin.formations) {
    const parent = firstFrom.has(f.id) ? firstFrom.get(f.id)! : f.parent;
    tree.set(f.id, { id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent, acting: !!f.type, initial: { personnel: f.initial.personnel, tanks: f.initial.tanks } });
  }
  return {
    sides: ctx.scenario.sides.map((s) => ({ id: s.id, name: s.name })),
    formations: [...tree.values()],
    changes,
    snapshots: run.snapshots.map((s) => ({ time: s.time, units: s.units.map((u): UnitRow => [u.id, u.personnel, u.tanks, u.posture, u.destroyed ? 1 : 0, u.cutOff ? 1 : 0, u.ammo ?? 0]) })),
  };
}

export interface CardChild { id: string; name: string; echelon: string; personnel: number; tanks: number; state: string; out: boolean; hq: boolean }

export interface FormationCardData {
  id: string; name: string; side: string; sideName: string; echelon: string;
  /** Вышестоящий на момент (с переподчинениями). */
  parent: { id: string; name: string } | null;
  /** Момент данных (снимок после хода; у агентной модели — час). */
  time: string;
  /** active — на карте; pending — ещё не введено; destroyed — уничтожено (у штаба — все его соединения). */
  status: 'active' | 'pending' | 'destroyed';
  personnel: number; tanks: number;
  initial: { personnel: number; tanks: number };
  /** Доля от исходных (null — исходных нет). */
  share: { personnel: number | null; tanks: number | null };
  /** Положение словами (у штаба — по большинству людей его соединений). */
  posture: string | null;
  /** Отрезано от снабжения: у соединения — да/нет; у штаба — сколько соединений из скольких. */
  cutOff: { n: number; of: number };
  /** Боеприпасы, бк (у штаба — средние по людям). */
  ammo: number | null;
  /** Штаб: по скольким действующим соединениям сумма. */
  hq: boolean;
  members: number;
  children: CardChild[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Положение группы по долям людей (как знаки объединений на оперативном масштабе). */
export function groupPosture(by: Record<string, number>, total: number): string {
  const k = (p: string) => (total > 0 ? (by[p] ?? 0) / total : 0);
  return k('withdraw') > 0.4 ? 'отходит' : k('attack') > 0.4 ? 'наступает' : k('defend') > 0.4 ? 'обороняется' : 'на марше / в резерве';
}

/** Снимок на момент: последний не позже t (до первого — первый). */
export function snapshotAt(data: ReplayUnits, t: string): ReplayUnits['snapshots'][number] | null {
  let s = data.snapshots[0] ?? null;
  for (const x of data.snapshots) { if (x.time <= t) s = x; else break; }
  return s;
}

/** Вышестоящие на момент снимка: исходные с переподчинениями, вступившими до него. */
export function parentsAt(data: ReplayUnits, snapTime: string): Map<string, string | null> {
  const m = new Map(data.formations.map((f) => [f.id, f.parent]));
  for (const c of data.changes) if (c.to && c.time < snapTime) m.set(c.formation, c.to);
  return m;
}

/** Карточка формирования id на момент t (null — нет такого формирования или снимков). */
export function formationCard(data: ReplayUnits, id: string, t: string): FormationCardData | null {
  const byId = new Map(data.formations.map((f) => [f.id, f]));
  const f = byId.get(id);
  const snap = snapshotAt(data, t);
  if (!f || !snap) return null;
  const parents = parentsAt(data, snap.time);
  const kids = new Map<string, string[]>();
  for (const [c, p] of parents) if (p) kids.set(p, [...(kids.get(p) ?? []), c]);
  const rows = new Map(snap.units.map((u) => [u[0], u]));
  // исходные на момент: без пополнений, которые ещё не пришли
  const initialOf = (x: ReplayUnits['formations'][number]) => {
    let p = x.initial.personnel, k = x.initial.tanks;
    for (const c of data.changes) if (c.formation === x.id && c.time >= snap.time) { p -= c.personnel ?? 0; k -= c.tanks ?? 0; }
    return { personnel: Math.max(0, p), tanks: Math.max(0, k) };
  };
  /** Действующие соединения штаба (сам — если действующий, и все подчинённые вниз по дереву). */
  const acting = (root: string) => {
    const out: string[] = [], seen = new Set<string>(), st = [root];
    while (st.length) {
      const x = st.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      if (byId.get(x)?.acting) out.push(x);
      st.push(...(kids.get(x) ?? []));
    }
    return out;
  };
  const sum = (root: string) => {
    const x = byId.get(root)!;
    // действующее соединение — свои силы; штаб — сумма действующих подчинённых
    const ids = x.acting ? [root] : acting(root);
    let personnel = 0, tanks = 0, ip = 0, it = 0, cut = 0, on = 0, out = 0, ammoW = 0, w = 0;
    const by: Record<string, number> = {};
    for (const m of ids) {
      const ini = initialOf(byId.get(m)!);
      const r = rows.get(m);
      if (!r) continue; // ещё не введено — ни в силы, ни в исходные
      ip += ini.personnel; it += ini.tanks;
      if (r[4]) { out++; continue; }
      on++;
      personnel += r[1]; tanks += r[2]; ammoW += r[6] * Math.max(1, r[1]); w += Math.max(1, r[1]);
      by[r[3]] = (by[r[3]] ?? 0) + r[1];
      if (r[5]) cut++;
    }
    const pending = !on && !out;
    const status: FormationCardData['status'] = pending ? 'pending' : on ? 'active' : 'destroyed';
    const posture = !on ? null : x.acting ? POSTURE_RU[rows.get(root)![3]] ?? rows.get(root)![3] : groupPosture(by, personnel);
    return { ids, personnel, tanks, ip, it, cut, on, out, ammo: w ? ammoW / w : null, status, posture };
  };
  const me = sum(id);
  const pid = parents.get(id) ?? null;
  const ini = f.acting && me.status === 'pending' ? initialOf(f) : { personnel: me.ip, tanks: me.it };
  const side = data.sides.find((s) => s.id === f.side);
  const children: CardChild[] = (kids.get(id) ?? []).map((c) => {
    const x = byId.get(c)!, s = sum(c);
    return { id: c, name: x.name, echelon: x.echelon, personnel: s.personnel, tanks: s.tanks, out: s.status !== 'active', hq: !x.acting,
      state: s.status === 'pending' ? 'не введено' : s.status === 'destroyed' ? 'уничтожено' : s.posture ?? '' };
  }).filter((c) => byId.get(c.id)!.acting || acting(c.id).length > 0)
    .sort((a, b) => (RANK[b.echelon] ?? 0) - (RANK[a.echelon] ?? 0) || Number(a.out) - Number(b.out) || a.name.localeCompare(b.name, 'ru', { numeric: true }));
  return {
    id, name: f.name, side: f.side, sideName: side?.name ?? f.side, echelon: ECHELON_RU[f.echelon] ?? f.echelon,
    parent: pid && byId.get(pid) ? { id: pid, name: byId.get(pid)!.name } : null,
    time: snap.time, status: me.status,
    personnel: me.personnel, tanks: me.tanks, initial: ini,
    share: { personnel: ratio(me.personnel, ini.personnel), tanks: ratio(me.tanks, ini.tanks) },
    posture: me.posture, cutOff: { n: me.cut, of: me.on }, ammo: me.ammo,
    hq: !f.acting, members: me.on, children,
  };
}

/* ───────────── агентная модель: карточка штаба ───────────── */

/** Группа состояния агента-дивизии (как в машине состояний карточки агента). */
export function agentGroup(s: string): 'pending' | 'march' | 'deploy' | 'attack' | 'defense' | 'withdraw' | 'destroyed' | 'reserve' {
  if (s.startsWith('не введена')) return 'pending';
  if (s.startsWith('марш')) return 'march';
  if (s.startsWith('развёрт')) return 'deploy';
  if (s.startsWith('наступ')) return 'attack';
  if (s.startsWith('оборона')) return 'defense';
  if (s.startsWith('отход') || s.startsWith('отступ') || s.startsWith('остатки')) return 'withdraw';
  if (s.startsWith('небоеспособ') || s.startsWith('сведена')) return 'destroyed';
  return 'reserve';
}
const AGENT_POSTURE: Record<string, string> = { attack: 'attack', defense: 'defend', withdraw: 'withdraw', march: 'march', deploy: 'march', reserve: 'reserve' };

/**
 * Карточка штаба агентной модели на час: его дивизии (вниз по штабам), суммарные люди и танки введённых в
 * операцию (доля — от их же на начало), положение по большинству людей, отрезанные (в окружении), боеприпасы.
 */
export function agentHqCard(t: AgentTrace, id: string, hour: number): FormationCardData | null {
  const hq = t.hqs.find((h) => h.id === id);
  if (!hq || !t.frames.length) return null;
  const h = Math.max(0, Math.min(t.frames.length - 1, Math.round(hour)));
  const row = (i: number, at = h) => t.frames[at][i] as [number, number, string, number, number, number, number, number, number, number, number];
  const hqKids = (x: string) => t.hqs.filter((y) => y.parent === x).map((y) => y.id);
  const under = (root: string) => {
    const out: number[] = [], st = [root], seen = new Set<string>();
    while (st.length) {
      const x = st.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      t.divisions.forEach((d, i) => { if (d.hq === x) out.push(i); });
      st.push(...hqKids(x));
    }
    return out;
  };
  const sum = (idx: number[]) => {
    let personnel = 0, tanks = 0, ip = 0, it = 0, cut = 0, on = 0, out = 0, ammoW = 0, w = 0;
    const by: Record<string, number> = {};
    for (const i of idx) {
      const r = row(i), g = agentGroup(r[2]);
      if (g === 'pending') continue;
      const r0 = row(i, 0);
      ip += r0[3]; it += r0[4];
      if (g === 'destroyed') { out++; continue; }
      on++;
      personnel += r[3]; tanks += r[4]; ammoW += r[6] * Math.max(1, r[3]); w += Math.max(1, r[3]);
      by[AGENT_POSTURE[g]] = (by[AGENT_POSTURE[g]] ?? 0) + r[3];
      if ((r[10] ?? 0) > 0) cut++;
    }
    const status: FormationCardData['status'] = on ? 'active' : out ? 'destroyed' : 'pending';
    return { personnel, tanks, ip, it, cut, on, status, posture: on ? groupPosture(by, personnel) : null, ammo: w ? ammoW / w : null };
  };
  const me = sum(under(id));
  const parent = hq.parent ? t.hqs.find((x) => x.id === hq.parent) : undefined;
  const children: CardChild[] = [
    ...hqKids(id).map((k) => {
      const x = t.hqs.find((y) => y.id === k)!, s = sum(under(k));
      return { id: k, name: x.name, echelon: x.echelon, personnel: s.personnel, tanks: s.tanks, out: s.status !== 'active', hq: true, state: s.status === 'pending' ? 'не введена' : s.status === 'destroyed' ? 'выбыла' : s.posture ?? '' };
    }),
    ...t.divisions.map((d, i) => ({ d, i })).filter(({ d }) => d.hq === id).map(({ d, i }) => {
      const r = row(i), g = agentGroup(r[2]);
      return { id: d.id, name: d.name, echelon: 'division', personnel: g === 'pending' ? 0 : r[3], tanks: g === 'pending' ? 0 : r[4], out: g === 'pending' || g === 'destroyed', hq: false, state: r[2] };
    }),
  ];
  const start = Date.parse(`${t.start.slice(0, 16)}:00Z`) + h * 3600000;
  return {
    id, name: hq.name, side: hq.side, sideName: hq.side === 'su' ? 'Красная армия' : 'вермахт', echelon: ECHELON_RU[hq.echelon] ?? hq.echelon,
    parent: parent ? { id: parent.id, name: parent.name } : null,
    time: new Date(start).toISOString().slice(0, 16), status: me.status,
    personnel: Math.round(me.personnel), tanks: Math.round(me.tanks), initial: { personnel: Math.round(me.ip), tanks: Math.round(me.it) },
    share: { personnel: ratio(me.personnel, me.ip), tanks: ratio(me.tanks, me.it) },
    posture: me.posture, cutOff: { n: me.cut, of: me.on }, ammo: me.ammo, hq: true, members: me.on, children,
  };
}
