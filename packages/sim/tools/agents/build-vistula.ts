/**
 * Сценарий агентной модели «Висло-Одерская операция, 12.01–3.02.1945» — быстро, с допущениями (C), и история для
 * сверки. Реестра советских дивизий на январь 1945 г. пока нет (см. docs/system.md, раздел об агентной модели):
 * советская сторона раскладывается из армий и корпусов сценария нынешней модели, немецкая — дивизии сценария.
 *
 *   npm run agents:vistula-data
 *
 * - **Немецкая сторона.** Дивизии сценария нынешней модели (vistula-oder-1945.json) — каждая агентом: численность,
 *   положение, срок ввода — из сценария. Корпуса и крепости без разбивки по дивизиям (группа Заукена, V горный
 *   корпус СС, крепости Познань, Бреслау, Шнайдемюль) — одним агентом «корпусная группа».
 * - **Советская сторона (допущения, C).** Общевойсковая (ударная, гвардейская) армия — 9 стрелковых дивизий
 *   (3 корпуса по 3 — типовой состав 1945 г.), численность, танки и орудия армии поровну. Танковая армия — 2 танковых
 *   и 1 механизированный корпус поровну. Отдельный танковый корпус — агентом; кавалерийский корпус — 3 кавдивизии.
 *   Стрелковые корпуса, вводимые позже, — по 3 дивизии с типовыми числами.
 * - **Расстановка (C).** Дивизии армии — двумя эшелонами поперёк направления первого удара армии (к цели её первой
 *   задачи «наступать»; без неё — на запад): первый — две трети через 3 км по фронту, второй — на 6 км глубже;
 *   танковые корпуса — на 8 км глубже через 4 км. Первый эшелон наступающих армий развёрнут к началу.
 * - **Приказы** — исторические задачи сценария нынешней модели; приказ армии или корпусу — всем их агентам, цели
 *   сдвинуты на смещение агента от центра (не больше 8 км).
 * - **Артподготовка (C).** 1 УФ — 12.01 утром, 107 мин; 1 БФ — 14.01 утром, 25 мин (огневой налёт перед атакой
 *   передовых батальонов); плотность — норматив правил.
 * - **Полосы обороны** — рубежи театра (главная полоса перед плацдармами, Мезерицкий УР).
 *
 * Выход: packages/sim/data/scenarios/agents/vistula-oder-1945.json и vistula-oder-1945.history.json.
 */
import { HIGH_COMMAND } from './hierarchy';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;

type LngLat = [number, number];
interface TsFormation { id: string; name: string; side: 'su' | 'de'; echelon: string; parent: string | null; type?: string; position?: LngLat; personnel?: number; tanks?: number; guns?: number; ammo?: number; fuel?: number; enterAt?: string }
interface TsOrder { id: string; formation: string; task: string; target: string | LngLat | { formation: string } | null; issuedAt: string; note?: string }

const ts = rd<{ start: string; end: string; formations: TsFormation[]; orders: TsOrder[] }>('packages/sim/data/scenarios/vistula-oder-1945.json');
const tsHist = rd<{ positions: { formation: string; time: string; at: LngLat; approxKm: number; reliability: string; source?: string }[]; events: { id: string; title: string; date: string; kind: string; side?: string; place?: string; radiusKm?: number; formations?: string[]; source?: string }[] }>('packages/sim/data/scenarios/vistula-oder-1945.history.json');
const theatre = rd<{ areas: { id: string; name: string; ring: LngLat[] }[]; lines?: { id: string; fortification?: number; side?: string; depthKm?: number }[] }>('packages/sim/data/theatres/vistula-oder-1945.json');
const wehrmacht = rd<{ unitTypes: Record<string, { quality?: number }> }>('packages/sim/data/profiles/wehrmacht-1945.json');
const rkka = rd<{ unitTypes: Record<string, { quality?: number }> }>('packages/sim/data/profiles/rkka-1945.json');

const START = ts.start, END = ts.end;
const HOURS = Math.round((Date.parse(`${END}:00Z`) - Date.parse(`${START}:00Z`)) / 3600000);
const KX = 111.32 * Math.cos((51.5 * Math.PI) / 180), KY = 110.57;
const r4 = (p: LngLat): LngLat => [+p[0].toFixed(4), +p[1].toFixed(4)];
const center = (ps: LngLat[]): LngLat => ps.reduce<LngLat>((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length], [0, 0]);
const areaC = new Map(theatre.areas.map((a) => [a.id, center(a.ring)]));
const tsF = new Map(ts.formations.map((f) => [f.id, f]));
const targetOf = (t: TsOrder['target']): LngLat | null => (!t ? null : Array.isArray(t) ? (t as LngLat) : typeof t === 'string' ? areaC.get(t) ?? null : tsF.get(t.formation)?.position ?? null);
const KIND: Record<string, string> = { attack: 'attack', counterattack: 'attack', breakout: 'attack', relieve: 'attack', defend: 'defend', delay: 'defend', hold: 'hold', withdraw: 'withdraw', regroup: 'move', reserve: 'move' };
/** Типовые числа там, где в сценарии их нет (допущения). */
const DEF = { sd: { personnel: 5500, tanks: 0, guns: 120 }, tk: { personnel: 8000, tanks: 150, guns: 60 } };
/** Корпуса советских армий на 1.01.1945 (docs/sources/vistula-oder-1945-su-corps.json). */
interface SuCorps { id: string; name: string; kind: 'rifle' | 'tank' | 'mech'; divisions: number | null; source: string; reliability: string }
const suArmyComp = new Map(rd<{ armies: { army: string; corps: SuCorps[]; directDivisions?: number; note?: string }[] }>('docs/sources/vistula-oder-1945-su-corps.json').armies.map((a) => [a.army, a]));
const suCorps = new Map([...suArmyComp].map(([k, a]) => [k, a.corps]));
const newCorps: { id: string; name: string; army: string; src: string | null }[] = [];

interface Agent { id: string; name: string; side: 'su' | 'de'; hq: string; corps?: string; kind: string; mobility: 'foot' | 'motor' | 'tracked'; size: 'rifle' | 'tank' | 'other'; quality: number; personnel: number; tanks: number; guns: number; ammo: number; fuel: number; pos: LngLat; enterAt?: string; deployed?: boolean; notes: string[] }
const out: Agent[] = [];

// ---------- первая задача армии: направление удара ----------
const firstAttack = (id: string): LngLat | null => {
  const o = ts.orders.filter((x) => x.formation === id && ['attack', 'breakout'].includes(x.task)).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0];
  return o ? targetOf(o.target) : null;
};
/** Места в два эшелона поперёк направления удара: first — сколько в первом эшелоне. */
function slots(p: LngLat, dir: LngLat | null, n: number, first: number, step = 3, depth = 6): LngLat[] {
  let dx = -1, dy = 0;
  if (dir) { const vx = (dir[0] - p[0]) * KX, vy = (dir[1] - p[1]) * KY, L = Math.hypot(vx, vy); if (L > 1) { dx = vx / L; dy = vy / L; } }
  const nx = -dy, ny = dx;
  const at = (along: number, ahead: number): LngLat => [p[0] + (nx * along + dx * ahead) / KX, p[1] + (ny * along + dy * ahead) / KY];
  const res: LngLat[] = [];
  for (let i = 0; i < first; i++) res.push(at((i - (first - 1) / 2) * step, 2));
  const second = n - first;
  for (let i = 0; i < second; i++) res.push(at((i - (second - 1) / 2) * (step + 1), 2 - depth));
  return res;
}

// ---------- советская сторона: армии и корпуса → дивизии (C) ----------
const suArmies = ts.formations.filter((f) => f.side === 'su' && f.echelon === 'army');
for (const a of suArmies) {
  const p = a.position!, dir = firstAttack(a.id), q = rkka.unitTypes[a.type ?? '']?.quality ?? 1;
  const opens = !!ts.orders.find((o) => o.formation === a.id && o.task === 'attack' && o.issuedAt <= '1945-01-14T23:59');
  const known = suCorps.get(a.id);
  if (a.type === 'tank_army') {
    // корпуса танковой армии — по «Боевому составу» (есть в файле корпусов), иначе 2 танковых и 1 механизированный (C)
    const ks = known?.length ? known.map((c) => ({ name: c.name, kind: c.kind === 'mech' ? 'mk' : 'tk', src: c.source }))
      : [{ name: 'танковый корпус (1)', kind: 'tk' }, { name: 'танковый корпус (2)', kind: 'tk' }, { name: 'механизированный корпус (3)', kind: 'mk' }].map((x) => ({ ...x, src: null as string | null }));
    const ps = slots(p, dir, ks.length, ks.length, 4);
    ks.forEach((k, i) => out.push({
      id: `${a.id}_k${i + 1}`, name: `${a.name}: ${k.name}`, side: 'su', hq: a.id, kind: k.kind, mobility: 'tracked', size: 'tank', quality: q,
      personnel: Math.round((a.personnel ?? 40000) / ks.length), tanks: Math.round((a.tanks ?? 600) / ks.length), guns: Math.round((a.guns ?? 600) / ks.length), ammo: a.ammo ?? 3, fuel: a.fuel ?? 2, pos: r4(ps[i]),
      notes: [k.src ? `корпус танковой армии — ${k.src}; силы армии поровну (C)` : 'танковая армия — 2 танковых и 1 механизированный корпус, силы армии поровну (C)', 'положение: у армии поперёк направления удара (C)'],
    }));
    continue;
  }
  // стрелковые корпуса армии — по «Боевому составу» на 1.01.1945 (файл корпусов), иначе 3 условных по 3 дивизии (C);
  // корпуса, которые есть в сценарии нынешней модели (вводятся позже), — своими дивизиями ниже
  // армия без корпусов (1 А Войска Польского) — дивизии прямо под армией (id корпуса пустой)
  const direct = suArmyComp.get(a.id)?.directDivisions;
  const corpsList = direct
    ? [{ id: '', name: a.name, n: direct, src: suArmyComp.get(a.id)?.note ?? null }]
    : known?.length
    ? known.filter((c) => c.kind === 'rifle' && !tsF.has(c.id)).map((c) => ({ id: c.id, name: c.name, n: c.divisions ?? 3, src: c.source as string | null }))
    : [1, 2, 3].map((k) => ({ id: `${a.id}_sk${k}`, name: `${a.name.replace(/ армия.*$/, ' А')}: стрелковый корпус ${k} (условный)`, n: 3, src: null as string | null }));
  const N = corpsList.reduce((x, c) => x + c.n, 0), first = Math.round((N * 2) / 3), ps = slots(p, dir, N, first);
  let i = 0;
  for (const c of corpsList) for (let j = 0; j < c.n; j++, i++) out.push({
    id: `${a.id}_d${i + 1}`, name: `${c.name}: стрелковая дивизия ${j + 1}`, side: 'su', hq: a.id, ...(c.id ? { corps: c.id } : {}), kind: 'sd', mobility: 'foot', size: 'rifle', quality: q,
    personnel: Math.round((a.personnel ?? 9 * DEF.sd.personnel) / N), tanks: Math.round((a.tanks ?? 0) / N), guns: Math.round((a.guns ?? 9 * DEF.sd.guns) / N), ammo: a.ammo ?? 3, fuel: a.fuel ?? 2, pos: r4(ps[i]),
    ...(i < first && opens ? { deployed: true } : {}),
    notes: [c.src ? `армия — ${N} стрелковых дивизий по корпусам (${c.src}), силы армии поровну (C)` : 'армия — 9 стрелковых дивизий (3 корпуса по 3), силы армии поровну (C)', `положение: ${i < first ? 'первый' : 'второй'} эшелон поперёк направления удара армии (C)`],
  });
  for (const c of corpsList) if (c.id) newCorps.push({ id: c.id, name: c.name, army: a.id, src: c.src });
}
for (const c of ts.formations.filter((f) => f.side === 'su' && f.echelon === 'corps')) {
  const parent = c.parent ?? '';
  const pp = c.position ?? tsF.get(parent)?.position ?? [21, 51] as LngLat;
  const q = rkka.unitTypes[c.type ?? '']?.quality ?? 1;
  if (c.type === 'tank_corps' || c.type === 'mech_corps') {
    const [pos] = slots(pp, firstAttack(c.id) ?? firstAttack(parent), 1, 1, 4, 0);
    out.push({ id: c.id, name: c.name, side: 'su', hq: parent, kind: c.type === 'mech_corps' ? 'mk' : 'tk', mobility: 'tracked', size: 'tank', quality: q,
      personnel: c.personnel ?? DEF.tk.personnel, tanks: c.tanks ?? DEF.tk.tanks, guns: c.guns ?? DEF.tk.guns, ammo: c.ammo ?? 3, fuel: c.fuel ?? 2, pos: r4(c.position ? pos : [pp[0] + 0.05, pp[1]]),
      ...(c.enterAt ? { enterAt: c.enterAt } : {}), notes: [c.personnel ? 'численность: сценарий нынешней модели' : 'численность: типовая танкового корпуса (допущение)', 'положение: сценарий нынешней модели'] });
    continue;
  }
  const cav = c.type === 'cavalry_corps';
  const ps = slots(pp, firstAttack(c.id) ?? firstAttack(parent), 3, 3, 4);
  for (let i = 0; i < 3; i++) out.push({
    id: `${c.id}_d${i + 1}`, name: `${c.name}: ${cav ? 'кавалерийская' : 'стрелковая'} дивизия ${i + 1}`, side: 'su', hq: c.id, kind: cav ? 'kd' : 'sd', mobility: cav ? 'motor' : 'foot', size: cav ? 'other' : 'rifle', quality: q,
    personnel: c.personnel ? Math.round(c.personnel / 3) : DEF.sd.personnel, tanks: c.tanks ? Math.round(c.tanks / 3) : 0, guns: c.guns ? Math.round(c.guns / 3) : DEF.sd.guns,
    ammo: c.ammo ?? 3, fuel: c.fuel ?? 2, pos: r4(ps[i]), ...(c.enterAt ? { enterAt: c.enterAt } : {}),
    notes: [c.personnel ? 'корпус — 3 дивизии, силы корпуса поровну (C)' : 'корпус — 3 дивизии с типовыми числами (допущение)', 'положение: у корпуса (C)'],
  });
}

// ---------- немецкая сторона: дивизии сценария, корпусные группы ----------
for (const d of ts.formations.filter((f) => f.side === 'de' && f.echelon === 'division')) {
  const tracked = d.type === 'pz_div' || d.type === 'pzgr_div' || d.type === 'ss_pzgr_div';
  out.push({ id: d.id, name: d.name, side: 'de', hq: d.parent ?? '', kind: d.type === 'fortress' ? 'garrison' : tracked ? 'pd' : 'div', mobility: tracked ? 'tracked' : 'foot', size: tracked ? 'tank' : d.type === 'fortress' ? 'other' : 'rifle',
    quality: wehrmacht.unitTypes[d.type ?? '']?.quality ?? 0.9, personnel: d.personnel ?? 6000, tanks: d.tanks ?? (tracked ? 60 : 8), guns: d.guns ?? (tracked ? 80 : 60), ammo: d.ammo ?? 1.5, fuel: d.fuel ?? 1, pos: r4(d.position!),
    ...(d.enterAt ? { enterAt: d.enterAt } : {}), notes: ['численность, положение, ввод — сценарий нынешней модели'] });
}
for (const c of ts.formations.filter((f) => f.side === 'de' && f.echelon === 'corps' && f.personnel && f.position)) {
  const tracked = /panzer/.test(c.type ?? '');
  out.push({ id: c.id, name: `${c.name} (корпусная группа)`, side: 'de', hq: c.parent ?? '', kind: c.type === 'fortress' ? 'garrison' : 'corps', mobility: tracked ? 'tracked' : 'foot', size: tracked ? 'tank' : 'rifle',
    quality: wehrmacht.unitTypes[c.type ?? '']?.quality ?? 0.9, personnel: c.personnel!, tanks: c.tanks ?? (tracked ? 100 : 0), guns: c.guns ?? 100, ammo: c.ammo ?? 1.5, fuel: c.fuel ?? 1, pos: r4(c.position!),
    ...(c.enterAt ? { enterAt: c.enterAt } : {}), notes: ['корпус без разбивки по дивизиям — один агент; численность и положение — сценарий нынешней модели'] });
}
const agentIds = new Set(out.map((o) => o.id));

// ---------- штабы ----------
const hqF = ts.formations.filter((f) => !agentIds.has(f.id) && f.echelon !== 'division');
const under = (id: string, hq: string): boolean => { for (let x: string | null | undefined = id, n = 0; x && n < 8; x = tsF.get(x)?.parent, n++) if (x === hq) return true; return false; };
const agentsUnder = (hq: string) => out.filter((o) => o.hq === hq || under(o.hq, hq));
const hqs = hqF.map((h) => {
  const kids = agentsUnder(h.id);
  return { id: h.id, name: h.name, side: h.side, echelon: h.echelon === 'front' ? 'front' : h.echelon === 'army' ? 'army' : 'corps', parent: h.parent && tsF.has(h.parent) && !agentIds.has(h.parent) ? h.parent : null,
    pos: r4(h.position ?? (kids.length ? center(kids.map((k) => k.pos)) : [21, 51])) };
}).filter((h) => agentsUnder(h.id).length || hqF.some((x) => x.parent === h.id));
for (const o of out) if (!hqs.some((h) => h.id === o.hq)) console.warn(`нет штаба ${o.hq} у ${o.id}`);

// ---------- приказы ----------
const clampKm = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
const posOf = new Map(out.map((o) => [o.id, o.pos]));
const orders: unknown[] = [];
let skipped = 0, empty = 0;
for (const o of ts.orders) {
  if (o.issuedAt >= END) continue;
  const kind = KIND[o.task];
  if (!kind) { skipped++; continue; }
  const to = agentIds.has(o.formation) ? [o.formation] : agentsUnder(o.formation).map((x) => x.id);
  if (!to.length) { empty++; continue; }
  const tgt = targetOf(o.target);
  const at = o.issuedAt <= START ? 0 : o.issuedAt;
  const hq = agentIds.has(o.formation) ? out.find((x) => x.id === o.formation)!.hq : o.formation;
  const c = center(to.map((id) => posOf.get(id)!));
  const follow = o.target && typeof o.target === 'object' && !Array.isArray(o.target) ? o.target.formation : null;
  for (const id of to) {
    const p = posOf.get(id)!;
    const off: LngLat = to.length > 1 ? [+clampKm((p[0] - c[0]) * KX, 8).toFixed(2), +clampKm((p[1] - c[1]) * KY, 8).toFixed(2)] : [0, 0];
    const t = tgt ? r4([tgt[0] + off[0] / KX, tgt[1] + off[1] / KY]) : kind === 'defend' || kind === 'hold' ? p : null;
    orders.push({ at, hq, to: [id], kind, target: t, ...(follow && agentIds.has(follow) ? { targetFormation: follow, offsetKm: off } : {}), note: `${o.note ?? ''} [${o.id}]`.trim() });
  }
}

// ---------- артподготовка (C) ----------
const frontOf = (id: string) => { for (let x: string | null | undefined = id, n = 0; x && n < 6; x = tsF.get(x)?.parent, n++) if (tsF.get(x)?.echelon === 'front') return x; return null; };
const opening = (front: string, until: string) => suArmies.filter((a) => frontOf(a.id) === front && a.type !== 'tank_army' && ts.orders.some((o) => o.formation === a.id && o.task === 'attack' && o.issuedAt <= until)).map((a) => a.id);
const fires = [
  ...opening('su_1uf_vo', '1945-01-12T23:59').map((hq) => ({ at: '1945-01-12T05:00', hq, durationMin: 107, densityPerKm: null, note: '1 УФ, 12.01 утром, 1 ч 47 мин (C); плотность — норматив правил (допущение)' })),
  ...opening('su_1bf_vo', '1945-01-14T23:59').map((hq) => ({ at: '1945-01-14T08:30', hq, durationMin: 25, densityPerKm: null, note: '1 БФ, 14.01 утром, огневой налёт 25 мин перед атакой передовых батальонов (C); плотность — норматив правил (допущение)' })),
];

// ---------- полосы обороны (рубежи театра) ----------
const defenseZones = (theatre.lines ?? []).filter((l) => l.side === 'de' && l.fortification).map((l) => ({ line: l.id, depthKm: l.depthKm ?? 5, level: Math.min(3, l.fortification!), towards: 'west', note: 'рубеж театра vistula-oder-1945' }));

// ---------- история для сверки ----------
const endDay = END.slice(0, 10);
const histDiv = tsHist.positions.filter((p) => agentIds.has(p.formation) && p.time > START && p.time < endDay)
  .map((p) => ({ formation: p.formation, time: p.time, at: p.at, approxKm: p.approxKm, set: 'vistula-oder-1945.history', reliability: p.reliability, source: p.source }));
const hqIds = new Set(hqs.map((h) => h.id));
const histArmy = tsHist.positions.filter((p) => hqIds.has(p.formation) && p.time >= START.slice(0, 10) && p.time < endDay)
  .map((p) => ({ formation: p.formation, time: p.time, at: p.at, approxKm: p.approxKm, reliability: p.reliability, source: p.source }));
const events = tsHist.events.filter((e) => e.date < endDay).map((e) => ({ ...e, at: e.place ? areaC.get(e.place) ?? null : null }));

// ---------- советские стрелковые корпуса и верхние инстанции ----------
// Как в build-berlin.ts: расстановка и приказы посчитаны по армии; дивизия встаёт под свой корпус, корпус — под армию,
// фронты и группы армий — под верхние инстанции.
type HqOut = { id: string; name: string; side: string; echelon: string; parent: string | null; pos: LngLat; note?: string };
const hqOut = hqs as HqOut[];
for (const c of newCorps) hqOut.push({ id: c.id, name: c.name, side: 'su', echelon: 'corps', parent: c.army, pos: r4(center(out.filter((o) => o.corps === c.id).map((o) => o.pos))), note: c.src ? `состав корпуса — ${c.src}` : 'условный корпус: состав армии на 1.01.1945 не найден (C)' });
for (const o of out) if (o.corps) { o.hq = o.corps; delete o.corps; }
const sideCenter = (side: string) => r4(center(out.filter((o) => o.side === side).map((o) => o.pos)));
for (const h of hqOut) if (h.parent == null) h.parent = HIGH_COMMAND[h.side as 'su' | 'de'].id;
for (const side of ['su', 'de'] as const) hqOut.push({ id: HIGH_COMMAND[side].id, name: HIGH_COMMAND[side].name, side, echelon: 'high_command', parent: null, pos: sideCenter(side) });

// ---------- запись ----------
const scenario = {
  id: 'agents-vistula-oder-1945',
  name: 'Висло-Одерская операция, 12.01–3.02.1945 (агенты-дивизии, с допущениями)',
  theatre: 'packages/sim/data/theatres/vistula-oder-1945.json',
  start: START, hours: HOURS, seed: 1,
  timeNote: 'время московское, как в сценарии нынешней модели; собрано npm run agents:vistula-data — советская сторона разложена из армий с допущениями (C)',
  hqs, divisions: out.map(({ notes, ...d }) => ({ ...d, note: notes.join('; ') })), orders, fires, withdrawals: [], defenseZones, cityRings: [],
};
const dir = resolve(ROOT, 'packages/sim/data/scenarios/agents');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'vistula-oder-1945.json'), JSON.stringify(scenario, null, 1) + '\n');
writeFileSync(resolve(dir, 'vistula-oder-1945.history.json'), JSON.stringify({
  scenario: scenario.id,
  note: 'положения — история сценария нынешней модели: немецкие дивизии и советские танковые корпуса (агенты) — сверка; армии и корпуса — для сравнения с нынешней моделью',
  divisions: histDiv, armies: histArmy, events, rejected: [], losses: [],
}, null, 1) + '\n');
const su = out.filter((o) => o.side === 'su'), de = out.filter((o) => o.side === 'de');
console.log(`агентов: советских ${su.length}, немецких ${de.length}; штабов ${hqs.length}; приказов ${orders.length} (пропущено видов ${skipped}, без получателей ${empty}); артподготовок ${fires.length}; полос ${defenseZones.length}`);
console.log(`история: положений агентов ${histDiv.length}, штабов ${histArmy.length}, событий ${events.length}; часов ${HOURS}`);
