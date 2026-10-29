/**
 * Мерило 2 «Истории как замысла» (docs/superpowers/specs/2026-10-29-history-intent-design.md, раздел 4): прогоны
 * Берлинской в режиме `intent` без вмешательства и с каждым заготовленным вмешательством
 * (packages/sim/data/scenarios/agents/berlin-1945.interventions.json) и признаки правдоподобия по ходу:
 *   idleMaxHours — наибольшее число часов подряд после часа вмешательства, когда советская армия вне истории и без
 *     действующей задачи (задачи нет или её цель достигнута; оборона — задача);
 *   frontAdvanceKm — смещение центра советского фронта за операцию (и к Берлину);
 *   berlin — «взят» (советские дивизии в кольце «Цитадели»), «окружён» (все немецкие дивизии в городском обводе
 *     отрезаны) или «нет» — на конец срока;
 *   untouchedKm48 — средняя разница центров армий, которых вмешательство не касалось, в первые 48 ч после него против
 *     прогона без вмешательства с тем же seed (affectedKm48 — то же у затронутых);
 *   reasons — доля уходов с истории («сам», «со сдвигом») с записанной причиной.
 *
 *   npx tsx packages/sim/tools/agents/interventions.ts --seeds 1-10 [--jobs 5] [--out evals-out/reports/interventions.md]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTrace } from '../../src/agents';

type LngLat = [number, number];
/** Выбывшие: рассеяна, сведена, не введена. */
const OUT = new Set(['небоеспособна', 'сведена в другую дивизию', 'не введена в операцию']);
/** Берлин (центр города) — направление «к Берлину». */
export const BERLIN: LngLat = [13.4, 52.52];

const km = (a: LngLat, b: LngLat) => {
  const c = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * 111.32 * c, (b[1] - a[1]) * 110.57);
};
const inside = (p: LngLat, ring: LngLat[]) => {
  let ok = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
};

/** Поля кадра. */
function fieldsOf(t: AgentTrace) {
  const f = (k: string) => t.fields.indexOf(k);
  return { lng: f('lng'), lat: f('lat'), state: f('state'), enc: f('encircled') };
}
const alive = (t: AgentTrace, h: number, i: number) => !OUT.has(t.frames[h][i][fieldsOf(t).state] as string);
const pos = (t: AgentTrace, h: number, i: number): LngLat => { const f = fieldsOf(t); return [t.frames[h][i][f.lng] as number, t.frames[h][i][f.lat] as number]; };

/** Штаб `hq` и его подчинённые. */
function subtree(t: AgentTrace, hq: string): Set<string> {
  const parent = new Map(t.hqs.map((h) => [h.id, h.parent]));
  return new Set(t.hqs.map((h) => h.id).filter((id) => { let x: string | null | undefined = id; for (let k = 0; k < 8 && x; k++) { if (x === hq) return true; x = parent.get(x); } return false; }));
}
/** Дивизии штаба (с подчинёнными). */
const divisionsOf = (t: AgentTrace, hq: string) => { const s = subtree(t, hq); return t.divisions.map((d, i) => (s.has(d.hq) ? i : -1)).filter((i) => i >= 0); };
/** Центр живых дивизий на часе; живых нет — null. */
function center(t: AgentTrace, h: number, divs: number[]): LngLat | null {
  const ps = divs.filter((i) => alive(t, h, i)).map((i) => pos(t, h, i));
  return ps.length ? [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length] : null;
}
const armies = (t: AgentTrace, side?: string) => t.hqs.filter((h) => h.echelon === 'army' && (!side || h.side === side));

/** Задача оборонительная («оборонять», «сдерживать», «в резерв») — действует, пока не сменена. */
const DEFEND = /^(оборонять|сдерживать|в резерв)/;
/** Цель документа: ближайшая задача («рубеж у ШИРОТА, ДОЛГОТА»), нет — последующая; нет и её — null. */
const goalOf = (text: string): LngLat | null => { const m = /у (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(text); return m ? [+m[2], +m[1]] : null; };

/** Статус армии по часам из поля `intent` хода: вне истории («сам», «со сдвигом») — true. */
function offHistory(t: AgentTrace, army: string, hours: number): boolean[] {
  const ch = [...(t.intent?.find((x) => x.hq === army)?.changes ?? [])].sort((a, b) => a.tick - b.tick);
  const out: boolean[] = [];
  let k = 0, off = false;
  for (let h = 0; h <= hours; h++) { while (k < ch.length && ch[k].tick <= h) off = ch[k++].status !== 'history'; out.push(off); }
  return out;
}

/** Наибольшее число часов подряд на отрезке [t0, конец], когда советская армия вне истории («сам», «со сдвигом») и без
 * действующей задачи: документа-задачи (директива, приказ, распоряжение) ей нет или цель последнего достигнута (центр
 * армии ближе `contactKm`, как intent::done); оборонительная задача — действующая; документ без рубежа — действующий.
 * Армии на истории не в счёт (ритм задаёт история), как и армии без живых дивизий к концу. */
export function idleMaxHours(t: AgentTrace, t0: number, contactKm: number): { hours: number; army: string | null } {
  const end = t.frames.length - 1;
  let best = { hours: 0, army: null as string | null };
  for (const a of armies(t, 'su')) {
    const ds = divisionsOf(t, a.id);
    if (!center(t, end, ds)) continue;
    const off = offHistory(t, a.id, end);
    const docs = (t.documents ?? []).filter((d) => d.to.includes(a.id) && d.kind !== 'notice' && d.kind !== 'report').sort((x, y) => x.tick - y.tick);
    let run = 0, k = 0, cur: (typeof docs)[number] | null = null;
    for (let h = 0; h <= end; h++) {
      while (k < docs.length && docs[k].tick <= h) cur = docs[k++];
      if (h < t0 || !off[h]) { run = 0; continue; }
      const g = cur && !DEFEND.test(cur.text) ? goalOf(cur.text) : null;
      const c = center(t, h, ds);
      const idle = !cur || (g != null && c != null && km(c, g) <= contactKm);
      run = idle ? run + 1 : 0;
      if (run > best.hours) best = { hours: run, army: a.id };
    }
  }
  return best;
}

/** Смещение центра каждого советского фронта от начала до конца, км, и приближение к `goal`. */
export function frontAdvance(t: AgentTrace, goal: LngLat = BERLIN): { front: string; km: number; towardKm: number }[] {
  const end = t.frames.length - 1;
  return t.hqs.filter((h) => h.side === 'su' && h.echelon === 'front').flatMap((f) => {
    const ds = divisionsOf(t, f.id);
    const a = center(t, 0, ds), b = center(t, end, ds);
    return a && b ? [{ front: f.id, km: km(a, b), towardKm: km(a, goal) - km(b, goal) }] : [];
  });
}

/** Берлин на конец: «взят» — советская дивизия в кольце центра; «окружён» — все немецкие дивизии в городском обводе отрезаны. */
export function berlinState(t: AgentTrace, centerRing: LngLat[], cityRing: LngLat[]): 'взят' | 'окружён' | 'нет' {
  const end = t.frames.length - 1;
  const f = fieldsOf(t);
  const live = t.divisions.map((d, i) => ({ d, i })).filter(({ i }) => alive(t, end, i));
  if (live.some(({ d, i }) => d.side === 'su' && inside(pos(t, end, i), centerRing))) return 'взят';
  const de = live.filter(({ d, i }) => d.side === 'de' && inside(pos(t, end, i), cityRing));
  return de.length && de.every(({ i }) => !!t.frames[end][i][f.enc]) ? 'окружён' : 'нет';
}

/** Средняя по армиям (обеих сторон, кроме `skip`) разница центров против `base` за часы [t0, t0+hours], км. */
export function untouchedKm(t: AgentTrace, base: AgentTrace, t0: number, skip: Set<string>, hours = 48, only?: Set<string>): number | null {
  const per: number[] = [];
  for (const a of armies(t)) {
    if (skip.has(a.id) || (only && !only.has(a.id))) continue;
    const ds = divisionsOf(t, a.id);
    const v: number[] = [];
    for (let h = t0; h <= Math.min(t0 + hours, t.frames.length - 1, base.frames.length - 1); h++) {
      const p = center(t, h, ds), q = center(base, h, ds);
      if (p && q) v.push(km(p, q));
    }
    if (v.length) per.push(v.reduce((s, x) => s + x, 0) / v.length);
  }
  return per.length ? per.reduce((s, x) => s + x, 0) / per.length : null;
}

/** Первый час, когда советская дивизия в кольце центра; не было — null. */
export function berlinHour(t: AgentTrace, centerRing: LngLat[]): number | null {
  const su = t.divisions.map((d, i) => (d.side === 'su' ? i : -1)).filter((i) => i >= 0);
  for (let h = 0; h < t.frames.length; h++) if (su.some((i) => alive(t, h, i) && inside(pos(t, h, i), centerRing))) return h;
  return null;
}

/** Затронутые армии: штаб действия и его поддерево (армии в нём), для разрешения на отход — армия. */
export function affectedArmies(t: AgentTrace, actions: Record<string, Record<string, unknown>>[]): Set<string> {
  const out = new Set<string>();
  const army = new Set(armies(t).map((h) => h.id));
  for (const a of actions) for (const v of Object.values(a)) {
    const hq = (v.hq ?? v.to ?? v.army) as string | undefined;
    if (hq) for (const k of subtree(t, hq)) if (army.has(k)) out.add(k);
  }
  return out;
}

/** Доля смен «сам» / «со сдвигом» с причиной; смен нет — 1. */
export function reasonsShare(t: AgentTrace): number {
  const ch = (t.intent ?? []).flatMap((x) => x.changes).filter((c) => c.status !== 'history');
  return ch.length ? ch.filter((c) => c.reason != null).length / ch.length : 1;
}

// ---------- командная строка ----------
interface Case { id: string; name: string; actions: Record<string, Record<string, unknown>>[] }
interface Signs { idle: number; idleArmy: string | null; berlinHour: number | null; fronts: Record<string, { km: number; towardKm: number }>; berlin: string; untouched: number | null; affected: number | null; reasons: number }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const args = process.argv.slice(2);
  const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const seeds = opt('seeds', '1-10')!.split(',').flatMap((x) => { const [a, b] = x.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
  const SCEN = 'packages/sim/data/scenarios/agents/berlin-1945.json';
  const FILE = 'packages/sim/data/scenarios/agents/berlin-1945.interventions.json';
  const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;
  const scen = rd<{ start: string; cityRings: { level: number; ring: LngLat[] }[] }>(SCEN);
  const rings = [...scen.cityRings].sort((a, b) => a.level - b.level);
  const [cityRing, centerRing] = [rings[0].ring, rings[rings.length - 1].ring];
  const cases = rd<{ cases: Case[] }>(FILE).cases;
  const contactKm = rd<{ contactKm: { value: number } }>('packages/sim/data/rules/agents-v0.json').contactKm.value;
  const startH = Date.parse(`${scen.start}:00Z`) / 3600e3;
  const hourOf = (v: unknown) => (typeof v === 'number' ? v : Date.parse(`${v}:00Z`) / 3600e3 - startH);
  const t0Of = (c: Case) => Math.min(...c.actions.map((a) => { const v = Object.values(a)[0]; return 'from' in v ? hourOf(v.from) : 'after' in v ? hourOf(v.after) : 'at' in v ? hourOf(v.at) : 0; }));
  const BIN = resolve(ROOT, 'target/release/agents-run');
  const dir = 'evals-out/interventions';
  const run = (seed: number, c?: Case) => new Promise<string>((ok, fail) => {
    const out = `${dir}/${c?.id ?? 'base'}-${seed}`;
    const p = spawn(BIN, ['--scenario', SCEN, '--seed', String(seed), '--runs', '1', '--out', out, '--command', 'intent', ...(c ? ['--intervene', FILE, '--case', c.id] : [])], { cwd: ROOT, stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? ok(out) : fail(new Error(`agents-run ${c?.id ?? 'base'} seed ${seed}: код ${code}`))));
  });
  const signs = (t: AgentTrace, base: AgentTrace, c?: Case): Signs => {
    const t0 = c ? t0Of(c) : 0;
    const hit = c ? affectedArmies(t, c.actions) : new Set<string>();
    const idle = idleMaxHours(t, t0, contactKm);
    return {
      idle: idle.hours, idleArmy: idle.army, berlinHour: berlinHour(t, centerRing), fronts: Object.fromEntries(frontAdvance(t).map((f) => [f.front, { km: f.km, towardKm: f.towardKm }])),
      berlin: berlinState(t, centerRing, cityRing), untouched: c ? untouchedKm(t, base, t0, hit) : 0, affected: c ? untouchedKm(t, base, t0, new Set(), 48, hit) : null, reasons: reasonsShare(t),
    };
  };
  const all = new Map<string, Signs[]>();
  for (const seed of seeds) {
    const outs = await Promise.all([run(seed), ...cases.map((c) => run(seed, c))]);
    const base = rd<AgentTrace>(`${outs[0]}/trace.json`);
    all.set('base', [...(all.get('base') ?? []), signs(base, base)]);
    cases.forEach((c, k) => { const t = rd<AgentTrace>(`${outs[k + 1]}/trace.json`); all.set(c.id, [...(all.get(c.id) ?? []), signs(t, base, c)]); });
    for (const o of outs) rmSync(resolve(ROOT, o), { recursive: true, force: true });
    console.log(`seed ${seed}: готово`);
  }
  const mean = (v: (number | null)[]) => { const x = v.filter((y): y is number => y != null); return x.length ? x.reduce((s, y) => s + y, 0) / x.length : null; };
  const f1 = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));
  const fronts = ['su_1bf', 'su_1uf', 'su_2bf'];
  const top = (v: (string | null)[]) => { const m = new Map<string, number>(); for (const x of v) if (x) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ×${n}`).join(', '); };
  const rows = [{ id: 'base', name: 'без вмешательства' }, ...cases].map((c) => {
    const s = all.get(c.id)!;
    const b = ['взят', 'окружён', 'нет'].map((k) => `${k} ${s.filter((x) => x.berlin === k).length}`).join(' / ');
    const day = (h: number | null) => (h == null ? '—' : new Date((startH + h) * 3600e3).toISOString().slice(5, 13).replace('T', ' ').replace(/^(\d\d)-(\d\d)/, '$2.$1') + ':00');
    return `| ${c.name} (\`${c.id}\`) | ${f1(mean(s.map((x) => x.idle)))} (${Math.max(...s.map((x) => x.idle))}; ${top(s.map((x) => x.idleArmy)) || '—'}) | ${fronts.map((f) => `${f1(mean(s.map((x) => x.fronts[f]?.km ?? null)))} / ${f1(mean(s.map((x) => x.fronts[f]?.towardKm ?? null)))}`).join(' | ')} | ${b}; в «Цитадели» ≈ ${day(mean(s.map((x) => x.berlinHour)))} | ${f1(mean(s.map((x) => x.untouched)))} | ${f1(mean(s.map((x) => x.affected)))} | ${(mean(s.map((x) => x.reasons)) ?? 0).toFixed(3).replace('.', ',')} |`;
  });
  const md = ['# Мерило 2: вмешательства и признаки правдоподобия', '',
    `Берлинская операция, режим \`intent\`, seed ${opt('seeds', '1-10')}; средние по seed. Час вмешательства t0 — час первого действия случая (удержание — начало, изменение замысла — «после», разрешение — его час, снятие — 0).`, '',
    '| Случай | idleMaxHours, ч (макс по seed; чаще всего у) | 1 БФ: км / к Берлину | 1 УФ: км / к Берлину | 2 БФ: км / к Берлину | Берлин | untouchedKm48 | affectedKm48 | reasons |',
    '|---|---|---|---|---|---|---|---|---|', ...rows, '',
    'idleMaxHours — часы подряд, когда армия вне истории («сам», «со сдвигом») без действующей задачи: документа-задачи нет или центр армии у цели последнего ближе contactKm (оборона — задача); армии на истории не в счёт.', '',
    'Ожидалось: idleMaxHours ≤ 24; продвижение фронтов > 0; Берлин взят или окружён; reasons = 1; untouchedKm48 меньше affectedKm48.', ''].join('\n');
  const out = opt('out', 'evals-out/reports/interventions.md')!;
  mkdirSync(dirname(resolve(ROOT, out)), { recursive: true });
  writeFileSync(resolve(ROOT, out), md);
  writeFileSync(resolve(ROOT, out.replace(/\.md$/, '.json')), JSON.stringify(Object.fromEntries(all), null, 1));
  console.log(`отчёт: ${out}`);
}
