/**
 * «Варианты советника» по правилам и дополнение вариантов языковой модели до полных (без React). Варианты по правилам —
 * варианты командующего из ядра агентной модели (game_variants): задачи всем подчинённым пункта, ось, рубежи,
 * разграничительные линии, главный удар; тыл и переправы к ним добавляет это правило (ruleActs). Вариант модели
 * дополняется вариантом «продолжать»: у кого приказа модели нет — приказ правила с пометкой; приказ модели выбывшему
 * или чужому — снимается с пометкой. Без модели или при её отказе — варианты по правилам.
 */
import { createFeature, type Feature, type LngLat } from '@def-ops/core';
import type { StaffAction } from '@def-ops/sim';
import type { CoreOrder, CoreVariant, HumanDecision, PlanActView, PlanVariantView, TurnView, VariantDir } from './sim/game-protocol';
import { DRAFT_FIELDS, draftField, type DraftScope } from './decision-drafts';
import { blankDir, DIR_TASK_RU, dirTaskOf, recipients, type DirDraft } from './command-post';
import type { LevelId } from './map-level-scale';
import { parksKey, postBases, postSupply, priorityLimit, priorityPool, mergePriority, type StaffScope } from './post-staff';
import { hqCenter } from './post-views';
import { km, objectiveMark, shortName } from './post-objects';

export type { CoreOrder, CoreVariant, VariantDir };

/** Масштаб знака большой реки на слое карты «rivers» (малые — 0,7): по нему переправы узнают большие реки. */
export const RIVER_MAJOR_K = 1.3;
/** Знак реки театра на слое «rivers» (большие — толще). Реки идут картой, а не полем вида: так вид хода не тяжелеет. */
export function riverFeature(rv: { name?: string; major?: boolean; line: LngLat[] }): Feature {
  const f = createFeature('line', 'inf.river', { points: rv.line, layerId: 'rivers' }, rv.major ? RIVER_MAJOR_K : 0.7);
  f.name = rv.name;
  return f;
}
/** Большие реки театра — из знаков слоя карты «rivers». */
export function majorRivers(v: TurnView): { name: string; line: LngLat[] }[] {
  return (v.doc?.features ?? []).filter((f) => f.layerId === 'rivers' && f.kind === 'line' && (f.scale ?? 0) >= RIVER_MAJOR_K)
    .map((f) => ({ name: f.name ?? '', line: (f as { points: LngLat[] }).points }));
}

/** Пометка варианта, составленного правилом, без языковой модели. */
export const RULES_MARK = 'по правилам, без модели';

const pts = (x: unknown): LngLat[] => (Array.isArray(x) ? x.filter((p): p is LngLat => Array.isArray(p) && p.length >= 2) : []);
const plain = (s: string) => s.replace(/\s*\([^)]*\)/g, '').trim();
const nameOf = (v: TurnView, id: string) => v.command?.hqs[id]?.name ?? v.own.find((u) => u.id === id)?.name ?? id;
const attacking = (d: { task: string }) => dirTaskOf(d.task) === 'attack';

/** Приказ ядра — без пустых полей (immediate бывает null). */
function normOrder(o: CoreOrder): CoreOrder {
  return { ...o, axis: pts(o.axis), immediate: pts(o.immediate), subsequent: pts(o.subsequent), right: pts(o.right), left: pts(o.left), note: o.note ?? '' };
}

/** Цель приказа словами: ближайший пункт к точке цели (не дальше 15 км). */
function targetText(v: TurnView, d: VariantDir): string {
  const mk = objectiveMark(dirDraftOf(d, 'front'), d.name);
  if (!mk) return '';
  let best: { t: string; k: number } | null = null;
  for (const p of v.places ?? []) { const k = km(p.at, mk.at); if (k <= 15 && (!best || k < best.k)) best = { t: plain(p.title), k }; }
  return best?.t ?? '';
}

/** Приказ словами: «8 гв. А — наступать: Зелов». */
const dirWords = (v: TurnView, d: VariantDir) => { const t = d.target ?? targetText(v, d); return `${shortName(d.name)} — ${DIR_TASK_RU[dirTaskOf(d.task)]}${t ? `: ${t}` : ''}`; };

/** Вариант ядра → вариант советника пункта: решение по обстановке, приказы всем подчинённым, тыл и переправы по правилам. */
export function fromCore(v: TurnView, s: DraftScope, issuer: string, c: CoreVariant, scope: StaffScope | null): PlanVariantView {
  const subs = new Set(v.command ? recipients(v, issuer).map((x) => x.id) : []);
  const dirs: VariantDir[] = c.orders.map(normOrder).filter((o) => !subs.size || subs.has(o.to))
    .map((o) => ({ ...o, name: nameOf(v, o.to), mainBlow: c.mainBlow ?? [] })).map((x) => ({ ...x, target: targetText(v, x) || undefined }));
  const d: HumanDecision = { assessment: '', enemyIntent: '', intent: '', report: '', risks: '' };
  const intent = `${c.label}. ${dirs.map((x) => dirWords(v, x)).join('; ')}.`;
  for (const f of DRAFT_FIELDS) d[f] = f === 'intent' ? intent : draftField(f, v, s, d);
  return { title: c.label, idea: c.rule, source: 'rules', decision: d, orders: [], dirs, acts: ruleActs(v, scope, dirs) };
}

/**
 * Вариант модели → полный вариант пункта (issuer): каждому получателю — приказ модели (задача, точка, обоснование) с
 * геометрией правила того же получателя; нет приказа модели — приказ правила (filled); приказы не получателям —
 * снимаются с пометкой. Нынешняя модель (issuer null): приказы как есть, kept — объединения без новых приказов.
 */
export function completeVariant(v: TurnView, issuer: string | null, llm: PlanVariantView, base: CoreVariant | null): PlanVariantView {
  if (!issuer || !v.command) {
    const given = new Set(llm.orders.filter((o) => o.ok).map((o) => o.formation));
    return { ...llm, source: 'llm', kept: v.own.filter((u) => u.status === 'active' && !given.has(u.id)).map((u) => u.name) };
  }
  const subs = recipients(v, issuer);
  const ids = new Set(subs.map((x) => x.id));
  const byTo = new Map((base?.orders ?? []).map(normOrder).map((o) => [o.to, o]));
  const mainBlow = base?.mainBlow ?? [];
  const orders = llm.orders.map((o) => (o.ok && !ids.has(o.formation) ? { ...o, ok: false, issue: 'выбыл или не в подчинении' } : o));
  const dirs: VariantDir[] = [];
  const filled: string[] = [];
  for (const r of subs) {
    const m = orders.find((o) => o.ok && o.formation === r.id);
    const b = byTo.get(r.id);
    if (m) {
      dirs.push({
        to: r.id, name: r.name, task: m.task, form: b?.form ?? (r.echelon === 'division' ? 'instruction' : 'order'),
        axis: b?.axis ?? [], immediate: m.at ? [m.at] : b?.immediate ?? [], subsequent: b?.subsequent ?? [], right: b?.right ?? [], left: b?.left ?? [],
        commit: b?.commit, echelon: b?.echelon ?? null, note: m.why ?? '', mainBlow, target: m.targetText || undefined,
      });
    } else if (b) { const x: VariantDir = { ...b, name: r.name, mainBlow, filled: true }; dirs.push({ ...x, target: targetText(v, x) || undefined }); filled.push(r.name); }
  }
  return { ...llm, source: 'llm', orders, dirs, filled };
}

/** Первая точка пересечения ломаной с ломаной (плоско, в градусах — на десятки километров достаточно). */
function crossing(a: LngLat[], b: LngLat[]): LngLat | null {
  for (let i = 0; i + 1 < a.length; i++) {
    let best: { t: number; p: LngLat } | null = null;
    for (let j = 0; j + 1 < b.length; j++) {
      const [p, p2] = [a[i], a[i + 1]], [q, q2] = [b[j], b[j + 1]];
      const r = [p2[0] - p[0], p2[1] - p[1]], s = [q2[0] - q[0], q2[1] - q[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) continue;
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
      const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, p: [p[0] + t * r[0], p[1] + t * r[1]] };
    }
    if (best) return best.p;
  }
  return null;
}

/** Пункт своей стороны: ближе к своим войскам, чем к обнаруженному противнику. */
function ownPlace(v: TurnView, at: LngLat): boolean {
  const near = (xs: { at: LngLat }[]) => xs.reduce((m, x) => Math.min(m, km(x.at, at)), Infinity);
  return near(v.own.filter((u) => u.status === 'active')) <= near(v.intel);
}

/**
 * Тыл и переправы варианта по правилам: приоритет подвоза — получателям на главном ударе и наступающим (не больше
 * трети); база, у войск которой подвоз дольше предела, — ближе к их центру, в свой пункт; переправа — где ось
 * наступающего пересекает большую реку, если рядом (3 км) нет моста и есть свободный понтонный парк.
 */
export function ruleActs(v: TurnView, scope: StaffScope | null, dirs: VariantDir[]): PlanActView[] {
  const out: PlanActView[] = [];
  const side = v.human?.id ?? '';
  const given = 'по правилу';
  // приоритет подвоза
  if (!scope || scope.priority) {
    const pool = scope ? priorityPool(v, scope) : v.own.filter((u) => u.status === 'active').map((u) => u.id);
    const lim = scope ? priorityLimit(pool.length) : v.priorityMax;
    const main = new Set(dirs[0]?.mainBlow ?? []);
    const cand = dirs.filter((d) => pool.includes(d.to) && (main.has(d.to) || attacking(d)));
    const chosen = [...cand.filter((d) => main.has(d.to)), ...cand.filter((d) => !main.has(d.to))].slice(0, lim).map((d) => d.to);
    if (chosen.length) {
      const formations = scope ? mergePriority(v.priority ?? [], pool, chosen) : chosen;
      const action: StaffAction = { kind: 'priority', side, formations, issuedAt: v.time };
      out.push({ key: 'priority', action, label: `Приоритет подвоза: ${chosen.map((id) => shortName(nameOf(v, id))).join(', ')}`, text: 'главный удар и наступающие — подвоз в первую очередь', given, ok: true });
    }
  }
  // базы снабжения
  const bases = scope ? (scope.bases === 'move' ? postBases(v, scope) : []) : v.bases;
  const active = (v.bases ?? []).filter((b) => b.state === 'active');
  const rows = scope ? postSupply(v, scope) : v.own.filter((u) => u.status === 'active').map((u) => ({ unit: u, hours: v.supplyHours[u.id] ?? null }));
  for (const b of bases.filter((x) => x.state === 'active')) {
    const centerOf = (id: string) => hqCenter(v, id) ?? v.own.find((u) => u.id === id)?.at ?? null;
    const mine = rows.filter((r) => { const c = centerOf(r.unit.id); if (!c) return false; const nb = active.reduce((m, x) => (km(x.at, c) < km(m.at, c) ? x : m), b); return nb.id === b.id; });
    const far = mine.filter((r) => r.hours == null || r.hours > v.rangeHours);
    if (!far.length) continue;
    const cs = far.map((r) => centerOf(r.unit.id)!).filter(Boolean);
    const c: LngLat = [cs.reduce((s, p) => s + p[0], 0) / cs.length, cs.reduce((s, p) => s + p[1], 0) / cs.length];
    const d0 = km(b.at, c);
    const to = (v.places ?? []).filter((p) => km(p.at, c) <= 0.7 * d0 && km(b.at, p.at) <= d0 && ownPlace(v, p.at))
      .reduce<{ id: string; title: string; at: LngLat } | null>((m, p) => (!m || km(b.at, p.at) < km(b.at, m.at) ? p : m), null);
    if (!to) continue;
    const action: StaffAction = { kind: 'base', side, base: b.id, to: to.at, toName: plain(to.title), issuedAt: v.time };
    out.push({ key: `base:${b.id}`, action, label: `База «${plain(b.name)}» — в ${plain(to.title)}`, text: `подвоз ${far.map((r) => shortName(r.unit.name)).join(', ')} дольше ${v.rangeHours} ч — база ближе к войскам`, at: to.at, from: b.at, given, ok: true });
  }
  // переправы
  const by = scope ? parksKey(v, scope.issuer) : undefined;
  const pk = by ? v.parksBy?.[by] : undefined;
  let free = scope ? (scope.bridges === 'build' ? (pk?.own ?? 0) - (pk?.busy ?? 0) : 0) : (v.parks ?? 0) - (v.bridges ?? []).filter((x) => x.building).length;
  const near = [...(v.crossings ?? []).map((x) => x.at), ...(v.bridges ?? []).map((x) => x.at)];
  const rivers = majorRivers(v);
  let i = 0;
  for (const d of dirs.filter(attacking)) {
    if (free <= 0) break;
    const line = d.axis.length >= 2 ? d.axis : [];
    let at: LngLat | null = null, river = '';
    for (const r of rivers) { const p = crossing(line, r.line); if (p && (!at || km(line[0], p) < km(line[0], at))) { at = p; river = r.name; } }
    if (!at || near.some((x) => km(x, at!) <= 3)) continue;
    const action: StaffAction = { kind: 'bridge', side, at, issuedAt: v.time, ...(by ? { by } : {}) };
    out.push({ key: `bridge:rule${i++}`, action, label: `Переправа: ${shortName(d.name)}${river ? ` — ${river}` : ''}`, text: 'ось наступления пересекает большую реку, моста рядом нет', at, given, ok: true });
    near.push(at); free--;
  }
  return out;
}

/** Что показать на карте: ось — стрелкой, правая и левая линии — линиями, точка цели, переправы и базы — точками; нынешняя модель — стрелки к целям приказов. */
export function variantFeatures(p: PlanVariantView, name: (id: string) => string): { kind: 'arrow' | 'line' | 'point'; pts: LngLat[]; name: string }[] {
  const out: { kind: 'arrow' | 'line' | 'point'; pts: LngLat[]; name: string }[] = [];
  if (p.dirs) {
    for (const d of p.dirs) {
      const nm = name(d.to);
      if (d.axis.length >= 2) out.push({ kind: 'arrow', pts: d.axis, name: `${nm}: ${DIR_TASK_RU[dirTaskOf(d.task)]}` });
      if (d.right.length >= 2) out.push({ kind: 'line', pts: d.right, name: `${nm}: правая разграничительная линия` });
      if (d.left.length >= 2) out.push({ kind: 'line', pts: d.left, name: `${nm}: левая разграничительная линия` });
      const mk = objectiveMark(dirDraftOf(d, 'front'), nm);
      if (mk) out.push({ kind: 'point', pts: [mk.at], name: `${nm}: точка цели` });
    }
  } else {
    for (const o of p.orders) if (o.ok && o.at) out.push({ kind: 'arrow', pts: [o.at], name: `${name(o.formation)}: ${o.targetText}` });
  }
  for (const a of p.acts) if (a.ok && a.at && (a.key.startsWith('bridge:') || a.key.startsWith('base:'))) out.push({ kind: 'point', pts: [a.at], name: a.label });
  return out;
}

/** Приказ варианта → проект документа пункта (указания составятся, если их нет). */
export function dirDraftOf(d: VariantDir, level: LevelId): DirDraft {
  const ech = d.echelon === 'second' ? 'second' : d.echelon === 'first' || d.echelon === 'mobile' ? 'first' : undefined;
  return {
    ...blankDir(d.to, level), task: dirTaskOf(d.task), form: level === 'division' ? 'instruction' : d.form === 'instruction' ? 'instruction' : 'order',
    axis: d.axis, immediate: d.immediate, subsequent: d.subsequent, boundaries: [d.right, d.left],
    // главный удар варианта — ступени пункта (его подчинённые); в документ получателю — его собственных нет
    mainBlow: [], ...(d.commit ? { commit: true } : {}), ...(ech ? { echelon: ech } : {}), note: d.note ?? '', noteAuto: !d.note,
  };
}

/**
 * Что показать, если модель вариантов не дала: модель недоступна (не спрашивали) или ответила без вариантов —
 * варианты по правилам; при ошибке модели — с предупреждением. Модель дала варианты — показывать нечего добавлять.
 */
export function planFallback(rules: PlanVariantView[], llm: { done: boolean; ok: boolean; error?: string; count: number }): { variants: PlanVariantView[]; warning?: string } {
  if (llm.count) return { variants: [] };
  if (!llm.done) return { variants: rules };
  return llm.error ? { variants: rules, warning: `Советник не ответил (${llm.error}) — показаны варианты по правилам.` } : { variants: rules };
}

/** История как замысел: получатели-штабы, которые идут по истории (не взяты и не ведомы игроком), — директива снимет их с истории. */
export function historyLoss(v: TurnView, dirs: VariantDir[]): string[] {
  const c = v.command;
  if (c?.mode !== 'intent') return [];
  return dirs.map((d) => c.hqs[d.to]).filter((h): h is NonNullable<typeof h> => !!h && h.control !== 'player' && !h.led).map((h) => h.name);
}
