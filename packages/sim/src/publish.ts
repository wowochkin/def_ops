/**
 * Прогон → карта редактора: знаки формирований с ключевыми кадрами по ходам,
 * линия фронта по ходам, бои за ход (стрелки), исторические положения и линии
 * фронта («призраки») для сравнения, рубежи театра. Всё на шкале времени
 * документа, поэтому прогон смотрится ползунком времени, как обычная карта.
 */
import { createFeature, emptyDocument, type ArrowFeature, type Feature, type LabelFeature, type Layer, type LineFeature, type LngLat, type MapDocument, type Side, type SymbolFeature } from '@def-ops/core';
import { frontLine, territoryLine } from './front';
import { dist } from './geo';
import { checkEvents, type History, type RunResult, type Snapshot } from './history';
import { power } from './rules';
import { addHours, onMap, profileOf, type SimContext } from './step';
import type { Formation } from './types';
import type { Theatre } from './theatre';
import { visualPath } from './roadnet';
import { groupOf as sectorGroups, sectorLines, sectorMap } from './sectors';

export interface PublishOptions {
  name?: string;
  /** Какая сторона «свои» (красные). */
  ownSide?: string;
  /** Показывать бои за ход стрелками. */
  combats?: boolean;
  /** Линия фронта рисуется, только где формирования обеих сторон ближе этого, км. */
  frontReachKm?: number;
  /** Наименьшая длина стрелки боя на карте, км. */
  /** Устарело: длина стрелок боёв теперь — по масштабу карты (клетка × 10). */
  minArrowKm?: number;
  /** Туман войны: показывать ли формирование противника в этом снимке (свои — всегда). Нет — показываются все. */
  visible?: (id: string, snapshot: Snapshot) => boolean;
}

/** Короткая подпись знака: «8 гв. А», «XI тк СС», «Франкфурт». */
export function shortName(name: string): string {
  const n = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const num = n.match(/^(\d+)-[яй]\s+/)?.[1];
  if (num) {
    const rest = n.slice(n.indexOf(' ') + 1);
    // сокращения штабных карт; собственное имя номерной дивизии («Берлин», «Нордланд») на карту не выносится
    const ss = / СС(?![А-Яа-яЁё])/.test(rest) ? ' СС' : '';
    const rules: [RegExp, string][] = [
      [/^Белорусский фронт/, 'БФ'], [/^Украинский фронт/, 'УФ'], [/^Прибалтийский фронт/, 'ПрибФ'],
      [/^гвардейская танковая армия/, 'гв. ТА'], [/^танковая армия/, 'ТА'], [/^ударная армия/, 'УА'],
      [/^гвардейская армия/, 'гв. А'], [/^армия Войска Польского/, 'А ВП'], [/^армия/, 'А'],
      [/^гвардейский танковый корпус/, 'гв. тк'], [/^танковый корпус/, 'тк'],
      [/^гвардейский стрелковый корпус/, 'гв. ск'], [/^стрелковый корпус/, 'ск'],
      [/^гвардейский механизированный корпус/, 'гв. мк'], [/^механизированный корпус/, 'мк'],
      [/^гвардейский кавалерийский корпус/, 'гв. кк'], [/^кавалерийский корпус/, 'кк'],
      [/^гвардейская стрелковая дивизия/, 'гв. сд'], [/^стрелковая дивизия/, 'сд'],
      [/^(добровольческая )?(танко-гренадерская|панцергренадерская)( \(.*?\))? дивизия/, `тгд${ss}`],
      [/^моторизованная( \(.*?\))? дивизия/, `мд${ss}`],
      [/^народно-гренадерская/, 'нгд'], [/^пехотная дивизия/, 'пд'], [/^танковая дивизия/, `тд${ss}`],
      [/^парашютная дивизия/, 'пар. д'], [/^егерская дивизия/, 'егд'], [/^дивизия особого назначения/, 'д ОН'],
    ];
    for (const [re, s] of rules) if (re.test(rest)) return `${num} ${s}`;
    const short = rest.replace(/\s*«[^»]*»/g, '');
    return short.length > 12 ? `${num} ${short.slice(0, 11)}…` : `${num} ${short}`;
  }
  const roman = n.match(/^([IVXLC]+)\s+(.*)$/);
  if (roman) {
    const rest = roman[2];
    const s = /танковый корпус СС/.test(rest) ? 'тк СС' : /горный корпус СС/.test(rest) ? 'гск СС' : /танковый корпус/.test(rest) ? 'тк' : /армейский корпус/.test(rest) ? 'ак' : rest;
    return `${roman[1]} ${s}`;
  }
  const q = n.match(/«([^»]+)»/);
  if (q) return `«${q[1]}»`;
  if (/^Крепость\s+/.test(n)) return n.replace(/^Крепость\s+/, '').replace(/-на-.*$/, '');
  if (/^Берлинский/.test(n)) return 'Берлин';
  if (/^Гарнизон крепости\s+/.test(n)) return `гарн. ${n.replace(/^Гарнизон крепости\s+/, '')}`;
  return n.length > 14 ? n.slice(0, 13) + '…' : n;
}

const POSTURE_RU: Record<string, string> = { attack: 'наступает', defend: 'обороняется', march: 'на марше', withdraw: 'отходит', reserve: 'в резерве' };

const tankish = (f: Formation, ctx: SimContext) => profileOf(ctx, f.side).unitTypes[f.type]?.mobility !== 'foot';

export function runToDocument(ctx: SimContext, run: RunResult, history?: History | null, o: PublishOptions = {}): MapDocument {
  o = { frontReachKm: 50, minArrowKm: 25, ...o };
  const own = o.ownSide ?? ctx.scenario.sides[0].id;
  const sideOf = (s: string): Side => (s === own ? 'own' : 'enemy');
  const T = ctx.theatre;
  const [w, s, e, n] = T.data.bbox;
  // вид — по войскам в начале (с запасом), не шире театра: операция ≈ 7, город ≈ 10
  const pts = (run.snapshots[0]?.units ?? []).filter((u) => !u.destroyed).map((u) => u.at);
  const lng = pts.length ? [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))] : [w, e];
  const lat = pts.length ? [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))] : [s, n];
  const span = Math.min(e - w, Math.max(lng[1] - lng[0], (lat[1] - lat[0]) * 1.6, 0.2) * 1.25);
  const zoom = +(Math.log2((360 * 900) / (256 * span)) - 0.6).toFixed(1);
  const doc = emptyDocument([(lng[0] + lng[1]) / 2, (lat[0] + lat[1]) / 2], zoom);
  // подписи соединений на экране разрежаются: при наложении остаётся подпись старшего (название — при наведении)
  doc.declutter = true;
  doc.name = o.name ?? `Переигровка: ${ctx.scenario.name}`;
  const mk = (id: string, name: string, role: Layer['role'], opacity = 1, visible = true): Layer => ({ id, name, role, visible, locked: true, opacity, source: { system: 'simulation', ref: ctx.scenario.id, readOnly: true } });
  doc.layers = [
    mk('theatre', 'Театр: рубежи и переправы', 'base', 0.8),
    mk('hist-front', 'История: линия фронта', 'front', 0.5),
    mk('hist-units', 'История: положения («призраки»)', 'custom', 0.45),
    mk('sim-front', 'Переигровка: линия фронта', 'front'),
    mk('sim-enemy', 'Переигровка: противник', 'enemy'),
    mk('sim-own', 'Переигровка: свои войска', 'friendly'),
    mk('sim-combat', 'Переигровка: бои за ход', 'custom', 0.8, o.combats !== false),
    mk('sim-marks', 'Переигровка: особые отметки', 'custom'),
    // разграничительные линии: по директивам (история) и расчётные полосы по уровням карты
    mk('hist-bounds', 'История: разграничительные линии по директивам', 'custom', 0.75),
    mk('sim-bounds', 'Переигровка: разграничительные линии фронтов', 'custom', 0.85),
    // уровни обобщения (переключаются в переигровке): оперативный — объединения, стратегический — фронты
    mk('lvl-op-units', 'Оперативный уровень: объединения', 'custom', 1, false),
    mk('lvl-op-moves', 'Оперативный уровень: направления действий', 'custom', 0.85, false),
    mk('lvl-op-bounds', 'Оперативный уровень: полосы фронтов и армий', 'custom', 0.85, false),
    mk('lvl-st-units', 'Стратегический уровень: фронты и группы армий', 'custom', 1, false),
    mk('lvl-st-moves', 'Стратегический уровень: направления ударов', 'custom', 0.85, false),
    mk('lvl-st-bounds', 'Стратегический уровень: полосы фронтов', 'custom', 0.85, false),
  ];
  const features: Feature[] = [];
  const end = run.final.time;
  doc.timeline = { start: ctx.scenario.start, end, current: ctx.scenario.start, motion: 'smooth' };

  // рубежи и переправы театра
  for (const l of T.data.lines) {
    const f = createFeature('line', 'std.frontLine', { points: l.line, layerId: 'theatre' }, 1, l.side === own ? 'own' : 'enemy');
    f.name = l.name;
    features.push(f);
  }
  for (const b of T.data.bridges) {
    if (!('openFrom' in b) || !b.openFrom) continue;
    const f = createFeature('symbol', 'std.pontoon', { at: b.at, layerId: 'theatre' }, 0.8, 'own') as SymbolFeature;
    f.name = b.name;
    f.time = { from: b.openFrom, to: b.destroyedAt ?? null };
    features.push(f);
  }

  // формирования: знак с ключевыми кадрами по ходам; с туманом войны (o.visible) — отрезками, пока противник обнаружен
  const byId = new Map(run.final.formations.map((f) => [f.id, f]));
  for (const f of run.final.formations) {
    const all = run.snapshots.map((sn, i) => ({ t: sn.time, i, u: sn.units.find((u) => u.id === f.id) })).filter((x) => x.u);
    if (!all.length) continue;
    const side = sideOf(f.side);
    const runs: (typeof all)[] = [];
    for (const x of all) {
      if (o.visible && side !== 'own' && !o.visible(f.id, run.snapshots[x.i])) continue;
      const cur = runs[runs.length - 1];
      if (cur && cur[cur.length - 1].i === x.i - 1) cur.push(x); else runs.push([x]);
    }
    for (const frames of runs) {
      const preset = tankish(f, ctx) ? 'std.mechCorps' : 'std.unitOval';
      const sym = createFeature('symbol', preset, { at: frames[0].u!.at, layerId: side === 'own' ? 'sim-own' : 'sim-enemy' }, 1, side) as SymbolFeature;
      sym.name = f.name;
      sym.labelRank = 10 + (RANK[f.echelon] ?? 0);
      sym.style = { ...sym.style, text: shortName(f.name), textStyle: { font: 'PT Sans Narrow', size: 10, weight: 700, italic: false, color: sym.style.color, halo: { color: '#ffffff', width: 2 }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1 } };
      const note = (u: NonNullable<(typeof frames)[number]['u']>) => `${u.personnel.toLocaleString('ru')} чел., ${u.tanks} танков; ${POSTURE_RU[u.posture] ?? u.posture}; боеприпасы ${u.ammo ?? '?'} бк${u.cutOff ? '; ОТРЕЗАНО от снабжения' : ''}`;
      // между ходами знак идёт пройденным путём (по дорогам и улицам), а не по прямой: промежуточные кадры — по точкам пути
      sym.keyframes = frames.flatMap((x, k) => {
        const end = { t: x.t, at: x.u!.at, note: note(x.u!) };
        const prev = k > 0 ? frames[k - 1] : null;
        if (!prev) return [end];
        const moved = prev.u!.at[0] !== x.u!.at[0] || prev.u!.at[1] !== x.u!.at[1];
        const path = x.u!.path ?? (moved ? [prev.u!.at, x.u!.at] : null);
        if (!path) return [end];
        // на карте — по линиям дорог (граф дорог театра), а не по клеткам расчёта
        return [...pathFrames(T, visualPath(T, path), prev.t, x.t).map((q) => ({ ...q, note: note(prev.u!) })), end];
      });
      const gone = frames.find((x) => x.u!.destroyed);
      const last = frames[frames.length - 1];
      const next = run.snapshots[last.i + 1];
      sym.time = { from: frames[0] === all[0] ? f.enterAt ?? null : frames[0].t, to: gone ? gone.t : last === all[all.length - 1] || !next ? null : next.time };
      features.push(sym);
    }
  }

  // линия фронта по ходам
  const sides = ctx.scenario.sides.map((x) => x.id) as [string, string];
  // линии фронта по ходам (в км) — к ним крепятся хвосты стрелок оперативного и стратегического масштабов
  const frontsByTurn: FrontsByTurn = new Map();
  for (let i = 0; i < run.snapshots.length; i++) {
    const sn = run.snapshots[i];
    const to = run.snapshots[i + 1]?.time ?? addHours(sn.time, ctx.scenario.turnHours);
    const units = sn.units.filter((u) => !u.destroyed).map((u) => ({ ...byId.get(u.id)!, position: u.at, personnel: u.personnel, tanks: u.tanks, destroyed: false }))
      .filter((f) => onMap(f, sn.time));
    // территория ведётся — фронт по её границе (сплошная полоса); иначе — изолиния влияния войск
    const terr = sn.territory ?? run.snapshots[i + 1]?.territory;
    // по территории — без мелких замкнутых островков (клочки, через которые войска не прошли) и с сильным сглаживанием
    const loopKm = (l: LngLat[]) => l.slice(1).reduce((sum, p, k) => sum + dist(T.proj.toXY(l[k]), T.proj.toXY(p)), 0);
    const closed = (l: LngLat[]) => dist(T.proj.toXY(l[0]), T.proj.toXY(l[l.length - 1])) < T.cellKm * 1.5;
    const raw = terr ? territoryLine(T, terr, 4).filter((l) => !(closed(l) && loopKm(l) < T.cellKm * 25))
      : frontLine(T, units, sides, (f) => power(f, profileOf(ctx, f.side), ctx.rules).total, { sigmaKm: 25 });
    const reachKm = terr ? Math.min(o.frontReachKm!, T.cellKm * 10) : o.frontReachKm!;
    // линия только там, где обе стороны рядом: в глубоком тылу изолиния есть, а фронта нет
    const near = (p: LngLat, side: string) => units.some((u) => u.side === side && dist(T.proj.toXY(u.position), T.proj.toXY(p)) <= reachKm);
    const lines: LngLat[][] = [];
    for (const line of raw) {
      let cur: LngLat[] = [];
      for (const p of line) {
        if (near(p, sides[0]) && near(p, sides[1])) cur.push(p);
        else { if (cur.length) lines.push(cur); cur = []; }
      }
      if (cur.length) lines.push(cur);
    }
    for (const line of lines) {
      if (line.length < 3) continue;
      const lf = createFeature('line', 'std.frontLine', { points: line, layerId: 'sim-front' }, 1, 'own');
      lf.time = { from: sn.time, to };
      lf.name = `Линия фронта (расчёт), ход ${sn.turn}`;
      features.push(lf);
      frontsByTurn.set(i, [...(frontsByTurn.get(i) ?? []), { id: lf.id, xy: line.map((q) => T.proj.toXY(q) as [number, number]) }]);
    }
  }

  // бои за ход: одна стрелка на бой — от наступающих к обороняющимся, длина в масштабе карты;
  // хвост позади знака; вид стрелки — по исходу (прорыв, продвижение, отражено)
  if (o.combats !== false) {
    const P = (p: LngLat) => T.proj.toXY(p);
    for (const j of run.final.journal) {
      if (j.kind !== 'combat') continue;
      const sn = run.snapshots.find((x) => x.time === j.time);
      const pos = (id: string) => sn?.units.find((u) => u.id === id)?.at ?? byId.get(id)!.position;
      const dc = j.defenders.map((id) => P(pos(id)));
      const d: [number, number] = [dc.reduce((a2, p) => a2 + p[0], 0) / dc.length, dc.reduce((a2, p) => a2 + p[1], 0) / dc.length];
      const strong = j.outcome === 'breakthrough' || j.outcome === 'advance';
      // одна стрелка на бой: от центра наступающих к обороняющимся; длина — в масштабе карты (клетка × 10)
      const ac = j.attackers.map((id) => P(pos(id)));
      const a0: [number, number] = [ac.reduce((s2, p) => s2 + p[0], 0) / ac.length, ac.reduce((s2, p) => s2 + p[1], 0) / ac.length];
      const v: [number, number] = [d[0] - a0[0], d[1] - a0[1]];
      const gap = Math.hypot(v[0], v[1]);
      const u: [number, number] = gap > 1e-6 ? [v[0] / gap, v[1] / gap] : [1, 0];
      const minLen = Math.max(T.cellKm * 10, 1.5);
      // успех — остриё за позицией обороны на глубину продвижения; неудача — обрывается, не дойдя до неё
      const reach = strong ? gap + Math.max(j.advanceKm, minLen * 0.25) : gap * 0.6;
      const back = Math.max(minLen - reach, minLen * 0.3);
      const tail = T.proj.toLL([a0[0] - u[0] * back, a0[1] - u[1] * back]);
      const mid = T.proj.toLL([a0[0] + u[0] * reach * 0.5, a0[1] + u[1] * reach * 0.5]);
      const head = T.proj.toLL([a0[0] + u[0] * reach, a0[1] + u[1] * reach]);
      const side = sideOf(byId.get(j.attackers[0])!.side);
      const k = j.outcome === 'breakthrough' ? 0.8 : strong ? 0.6 : 0.32;
      const arrow = <ArrowFeature>createFeature('arrow', side === 'own' ? 'inf.attackFade' : 'inf.counter', { points: [tail, mid, head], layerId: 'sim-combat' }, k, side);
      if (!strong) arrow.style = { ...arrow.style, fill: arrow.style.fill.map((c: { t: number; color: string; opacity: number }) => ({ ...c, opacity: c.opacity * 0.45 })) };
      arrow.time = { from: j.time, to: addHours(j.time, ctx.scenario.turnHours) };
      const outcome = { breakthrough: 'прорыв', advance: 'продвижение', held: 'оборона удержана', repelled: 'атака отбита' }[j.outcome];
      arrow.name = `${j.attackers.map((x) => shortName(byId.get(x)!.name)).join(', ')} → ${j.defenders.map((x) => shortName(byId.get(x)!.name)).join(', ')}: ${outcome}, соотношение ${j.ratio}${j.advanceKm ? `, ${j.advanceKm} км` : ''}`;
      features.push(arrow);
    }
  }

  features.push(...boundaryFeatures(ctx, run, sideOf, o.visible));

  // уровни обобщения: объединения и фронты — по своим соединениям, со стрелками направлений и рубежами обороны
  const labelK = Math.pow(2, doc.refZoom - zoom);
  features.push(...levelFeatures(ctx, run, sideOf, 'army', o.visible, labelK, frontsByTurn), ...levelFeatures(ctx, run, sideOf, 'front', o.visible, labelK, frontsByTurn));

  // история: «призраки» и линии фронта
  if (history) {
    const byF = new Map<string, History['positions']>();
    for (const p of history.positions) byF.set(p.formation, [...(byF.get(p.formation) ?? []), p]);
    for (const [fid, ps] of byF) {
      const f = byId.get(fid);
      if (!f) continue;
      const sorted = [...ps].sort((a, b) => a.time.localeCompare(b.time));
      const side = sideOf(f.side);
      const g = createFeature('symbol', tankish(f, ctx) ? 'std.mechCorps' : 'std.unitOval', { at: sorted[0].at, layerId: 'hist-units' }, 0.9, side) as SymbolFeature;
      g.name = `${f.name} (история)`;
      g.labelRank = RANK[f.echelon] ?? 0;
      g.style = { ...g.style, fill: 'none', text: shortName(f.name), textStyle: { font: 'PT Sans Narrow', size: 9, weight: 400, italic: true, color: g.style.color, halo: null, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1 } };
      g.keyframes = sorted.map((p) => ({ t: p.time, at: p.at, note: `${p.place} (${p.reliability}, ±${p.approxKm} км) — ${p.source}` }));
      g.time = { from: sorted[0].time, to: null };
      features.push(g);
    }
    const dates = [...new Set(history.frontline.map((l) => l.time))].sort();
    for (const l of history.frontline) {
      const next = dates[dates.indexOf(l.time) + 1] ?? null;
      const lf = createFeature('line', 'std.frontLine', { points: l.line, layerId: 'hist-front' }, 1.2, 'neutral');
      lf.name = `${l.sector} (история, ${l.time.slice(0, 10)})`;
      lf.time = { from: l.time, to: next };
      features.push(lf);
    }
  }

  // особые отметки событий (например, Знамя Победы над Рейхстагом): в момент события в расчёте и бледно — в исторический
  if (history?.events?.some((e) => e.marker)) {
    const results = new Map(checkEvents(ctx, run, history).map((r) => [r.id, r]));
    for (const e of history.events) {
      if (!e.marker || !('place' in e)) continue;
      const at = T.area(e.place)?.center;
      if (!at) continue;
      const r = results.get(e.id);
      if (r?.at) {
        const f = createFeature('symbol', e.marker.preset, { at, layerId: 'sim-marks' }, 1.2, 'own') as SymbolFeature;
        f.name = `${e.marker.name} (расчёт: ${r.simulated})`;
        f.time = { from: r.at, to: null };
        f.keyframes = [{ t: r.at, at, note: [e.marker.note, `по истории — ${e.marker.historicalAt?.replace('T', ' ') ?? e.date}`].filter(Boolean).join('; ') }];
        features.push(f);
      }
      if (e.marker.historicalAt) {
        const g = createFeature('symbol', e.marker.preset, { at, layerId: 'hist-units' }, 1, 'own') as SymbolFeature;
        g.name = `${e.marker.name} (история)`;
        g.time = { from: e.marker.historicalAt, to: null };
        if (e.marker.note) g.keyframes = [{ t: e.marker.historicalAt, at, note: e.marker.note }];
        features.push(g);
      }
    }
  }

  doc.features = features;
  return doc;
}

/* ------------------------- полосы и разграничительные линии ------------------------- */

/**
 * Разграничительные линии на карте:
 *  - по директивам (hist-bounds) — линии из Scenario.boundaries в сроки их действия, с источником в названии;
 *  - расчётные по ходам — границы полос фронтов (sim-bounds, lvl-st-bounds, lvl-op-bounds) и армий внутри фронта
 *    (lvl-op-bounds) от переднего края в глубину; где действует директива, расчётная линия идёт по ней.
 * С туманом войны (visible) — только свои полосы.
 */
function boundaryFeatures(ctx: SimContext, run: RunResult, sideOf: (s: string) => Side, visible?: PublishOptions['visible']): Feature[] {
  const T = ctx.theatre, out: Feature[] = [];
  const names = new Map(ctx.scenario.formations.map((f) => [f.id, shortName(f.name)]));
  for (const b of ctx.scenario.boundaries ?? []) {
    const air = b.kind === 'air';
    const f = createFeature('line', air ? 'rkka.boundaryUnit' : b.kind === 'army' ? 'rkka.boundaryArmy' : 'rkka.boundaryFront', { points: b.line, layerId: 'hist-bounds' }, 1, air ? 'neutral' : sideOf(b.side));
    const pair = air ? 'ВВС: советские / союзников' : `${names.get(b.right) ?? b.right} / ${names.get(b.left) ?? b.left}`;
    f.name = `${b.title} (${pair}): ${(b.places ?? []).join(' — ')}${b.source ? `. ${b.source}` : ''}${b.reliability ? ` (${b.reliability})` : ''}`;
    f.time = { from: b.from, to: b.until ?? null };
    out.push(f);
  }
  const front = sectorGroups(ctx.scenario, 'front'), army = sectorGroups(ctx.scenario, 'army');
  const sideOfF = new Map(ctx.scenario.formations.map((f) => [f.id, f.side]));
  // глубина линий от переднего края: операция — 40 км, город — ~5 км
  const depthKm = Math.min(40, T.cellKm * 20);
  const own = ctx.scenario.sides.map((x) => x.id).filter((sd) => !visible || sideOf(sd) === 'own');
  for (let i = 0; i < run.snapshots.length; i++) {
    const sn = run.snapshots[i];
    const to = run.snapshots[i + 1]?.time ?? addHours(sn.time, ctx.scenario.turnHours);
    const units = sn.units.filter((u) => !u.destroyed).map((u) => ({ id: u.id, side: sideOfF.get(u.id) ?? '', at: u.at }));
    for (const sd of own) {
      const side = sideOf(sd);
      const fm = sectorMap(T, ctx.scenario, units, sd, sn.time, { groups: front });
      if (fm.groups.length > 1) for (const l of sectorLines(T, fm, { depthKm })) {
        const nm = `Разграничительная линия ${l.pair.map((g) => names.get(g) ?? g).join(' / ')} (${l.historical >= 0.5 ? 'по директиве' : 'расчёт'}), ход ${sn.turn}`;
        for (const layerId of ['sim-bounds', 'lvl-op-bounds', 'lvl-st-bounds']) {
          const f = createFeature('line', 'rkka.boundaryFront', { points: l.points, layerId }, 0.8, side);
          f.name = nm;
          f.time = { from: sn.time, to };
          out.push(f);
        }
      }
      // полосы армий — внутри фронта
      const am = sectorMap(T, ctx.scenario, units, sd, sn.time, { level: 'army', groups: army });
      if (am.groups.length > 1) for (const l of sectorLines(T, am, { depthKm: depthKm * 0.6 })) {
        if ((front.get(l.pair[0]) ?? l.pair[0]) !== (front.get(l.pair[1]) ?? l.pair[1])) continue;
        const f = createFeature('line', 'rkka.boundaryArmy', { points: l.points, layerId: 'lvl-op-bounds' }, 0.7, side);
        f.name = `Разграничительная линия ${l.pair.map((g) => names.get(g) ?? g).join(' / ')} (расчёт), ход ${sn.turn}`;
        f.time = { from: sn.time, to };
        out.push(f);
      }
    }
  }
  return out;
}

/* ------------------------- уровни обобщения карты ------------------------- */

/** Название фронта или группы армий для карты: «1-й Белорусский фронт», «Группа армий «Висла»» — без пояснений в скобках. */
/** Промежуточные кадры: вершины пути (кроме концов), время — пропорционально пройденному расстоянию. */
function pathFrames(T: Theatre, path: LngLat[], t0: string, t1: string): { t: string; at: LngLat }[] {
  const xy = path.map((p) => T.proj.toXY(p));
  const seg = xy.slice(1).map((p, i) => Math.hypot(p[0] - xy[i][0], p[1] - xy[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const a = Date.parse(`${t0}Z`), b = Date.parse(`${t1}Z`);
  const out: { t: string; at: LngLat }[] = [];
  let run = 0;
  for (let i = 1; i < path.length - 1; i++) {
    run += seg[i - 1];
    out.push({ t: new Date(a + ((b - a) * run) / total).toISOString().slice(0, 16), at: path[i] });
  }
  return out;
}

function frontName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
}

const RANK: Record<string, number> = { regiment: 0, brigade: 1, division: 2, corps: 3, army: 4, front: 5 };

/** Объединение уровня level, в которое входит формирование: ближайший вышестоящий (или сам) не ниже уровня. */
type Node = { id: string; name: string; side: string; echelon: string; parent?: string | null };
function groupOf(f: Node, byId: Map<string, Node>, level: 'army' | 'front'): Node {
  let x: Node = f;
  for (;;) {
    if (RANK[x.echelon] >= RANK[level]) return x;
    const p = x.parent ? byId.get(x.parent) : undefined;
    if (!p) return x;
    x = p;
  }
}

/** Перекрасить заливку стрелки (сторона), сохранив прозрачность по длине. */
function recolor(a: ArrowFeature, color: string) {
  a.style = { ...a.style, fill: a.style.fill.map((c: { t: number; color: string; opacity: number }) => ({ ...c, color })), headFill: null };
}

/**
 * Знаки уровня: объединение (армия) или фронт — в центре своих соединений (по численности), с ключевыми кадрами
 * по ходам; стрелки — куда объединение сместилось за окно (сутки для армий, двое — для фронтов): вперёд, к
 * противнику — удар, назад — отход; стоящие в обороне — рубеж обороны поперёк направления на противника.
 */
type FrontsByTurn = Map<number, { id: string; xy: [number, number][] }[]>;
/** Ближайшая точка линий фронта хода (не дальше maxKm): линия, доля длины, точка. */
function nearestOnFront(lines: { id: string; xy: [number, number][] }[] | undefined, p: [number, number], maxKm: number): { id: string; t: number; at: [number, number] } | null {
  let best: { id: string; t: number; at: [number, number]; d: number } | null = null;
  for (const l of lines ?? []) {
    const seg: number[] = [0];
    for (let k = 1; k < l.xy.length; k++) seg.push(seg[k - 1] + Math.hypot(l.xy[k][0] - l.xy[k - 1][0], l.xy[k][1] - l.xy[k - 1][1]));
    const L = seg[seg.length - 1] || 1;
    for (let k = 1; k < l.xy.length; k++) {
      const a = l.xy[k - 1], b = l.xy[k], dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy || 1;
      const w = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll));
      const q: [number, number] = [a[0] + dx * w, a[1] + dy * w], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d <= maxKm && (!best || d < best.d)) best = { id: l.id, t: (seg[k - 1] + Math.sqrt(ll) * w) / L, at: q, d };
    }
  }
  return best && { id: best.id, t: best.t, at: best.at };
}

function levelFeatures(ctx: SimContext, run: RunResult, sideOf: (s: string) => Side, level: 'army' | 'front', visible: PublishOptions['visible'] | undefined, labelK: number, fronts: FrontsByTurn): Feature[] {
  const T = ctx.theatre, out: Feature[] = [];
  const byId = new Map(run.final.formations.map((f) => [f.id, f]));
  // иерархия — из сценария: штабы фронтов и армий без своих войск в расчёте не участвуют
  const tree = new Map<string, Node>(ctx.scenario.formations.map((f) => [f.id, f]));
  for (const f of run.final.formations) if (!tree.has(f.id)) tree.set(f.id, f);
  const acting = run.final.formations.filter((f) => f.type);
  const groups = new Map<string, { g: Node; members: string[] }>();
  for (const f of acting) { const g = groupOf(f, tree, level); const x = groups.get(g.id) ?? { g, members: [] }; x.members.push(f.id); groups.set(g.id, x); }
  const P = (p: LngLat) => T.proj.toXY(p), LL = (p: [number, number]) => T.proj.toLL(p);
  const lay = level === 'army' ? 'lvl-op' : 'lvl-st';
  const turnsPerDay = Math.max(1, Math.round(24 / ctx.scenario.turnHours));
  const win = level === 'army' ? turnsPerDay : 2 * turnsPerDay;
  const minKm = Math.max(T.cellKm * (level === 'army' ? 3 : 5), level === 'army' ? 0.6 : 1.2);
  // центр группы в снимке (видимые члены, по численности)
  type C = { xy: [number, number]; pers: number; tanks: number; n: number; attack: number; defend: number; withdraw: number; units: { xy: [number, number] }[] };
  const centre = (sn: Snapshot, members: string[], side: Side): C | null => {
    const us = sn.units.filter((u) => members.includes(u.id) && !u.destroyed && (side === 'own' || !visible || visible(u.id, sn)) && onMap({ ...byId.get(u.id)!, position: u.at }, sn.time));
    if (!us.length) return null;
    const w = us.reduce((a, u) => a + Math.max(1, u.personnel), 0);
    const xy = us.reduce<[number, number]>((a, u) => { const p = P(u.at), k = Math.max(1, u.personnel) / w; return [a[0] + p[0] * k, a[1] + p[1] * k]; }, [0, 0]);
    const by = (k: string) => us.filter((u) => u.posture === k).reduce((a, u) => a + u.personnel, 0) / w;
    return { xy, pers: us.reduce((a, u) => a + u.personnel, 0), tanks: us.reduce((a, u) => a + u.tanks, 0), n: us.length, attack: by('attack'), defend: by('defend'), withdraw: by('withdraw'), units: us.map((u) => ({ xy: P(u.at) })) };
  };
  const cents = new Map<string, (C | null)[]>();
  for (const [id, x] of groups) cents.set(id, run.snapshots.map((sn) => centre(sn, x.members, sideOf(x.g.side))));
  // для фронтов — их армии (центры по ходам): главные удары собираются из ударов армий
  const armyMinKm = Math.max(T.cellKm * 3, 0.6);
  const armiesOf = new Map<string, { g: Node; cs: (C | null)[] }[]>();
  if (level === 'front') {
    const am = new Map<string, { g: Node; members: string[]; front: string }>();
    for (const f of acting) { const a = groupOf(f, tree, 'army'), fr = groupOf(f, tree, 'front'); const y = am.get(a.id) ?? { g: a, members: [], front: fr.id }; y.members.push(f.id); am.set(a.id, y); }
    for (const y of am.values()) armiesOf.set(y.front, [...(armiesOf.get(y.front) ?? []), { g: y.g, cs: run.snapshots.map((sn) => centre(sn, y.members, sideOf(y.g.side))) }]);
  }
  const sideById = (id: string) => sideOf(groups.get(id)!.g.side);

  for (const [id, x] of groups) {
    const side = sideOf(x.g.side), cs = cents.get(id)!;
    const frames = run.snapshots.map((sn, i) => ({ sn, i, c: cs[i] })).filter((q) => q.c);
    if (!frames.length) continue;
    const tank = x.members.filter((m) => tankish(byId.get(m)!, ctx)).length * 2 > x.members.length;
    const posture = (c: C) => (c.withdraw > 0.4 ? 'отходит' : c.attack > 0.4 ? 'наступает' : c.defend > 0.4 ? 'обороняется' : 'на марше / в резерве');
    const note = (c: C) => `${c.n} соед., ${Math.round(c.pers).toLocaleString('ru')} чел., танков ${c.tanks}; ${posture(c)}`;
    const last = frames[frames.length - 1];
    const to = last.i === run.snapshots.length - 1 ? null : run.snapshots[last.i + 1].time;
    if (level === 'army') {
      const sym = createFeature('symbol', tank ? 'std.mechCorps' : 'std.unitOval', { at: LL(frames[0].c!.xy), layerId: `${lay}-units` }, 1.6, side) as SymbolFeature;
      sym.name = x.g.name;
      sym.labelRank = 20 + (RANK[x.g.echelon] ?? 0);
      sym.style = { ...sym.style, text: shortName(x.g.name), textStyle: { font: 'PT Sans Narrow', size: 13, weight: 700, italic: false, color: sym.style.color, halo: { color: '#ffffff', width: 2.5 }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1 } };
      sym.keyframes = frames.map((q) => ({ t: q.sn.time, at: LL(q.c!.xy), note: note(q.c!) }));
      sym.time = { from: frames[0].sn.time, to };
      out.push(sym);
    } else {
      // фронт — надпись, как на оперативной карте; размер — под исходный масштаб карты (надпись масштабируется с картой)
      const lb = createFeature('label', 'atlas.front', { at: LL(frames[0].c!.xy), text: frontName(x.g.name), layerId: `${lay}-units` }, labelK, side) as LabelFeature;
      lb.style = { ...lb.style, color: side === 'own' ? '#b3261e' : '#1f4e8c', halo: { color: '#ffffff', width: 3 * labelK } };
      lb.name = x.g.name;
      lb.keyframes = frames.map((q) => ({ t: q.sn.time, at: LL(q.c!.xy), note: note(q.c!) }));
      lb.time = { from: frames[0].sn.time, to };
      out.push(lb);
    }
    // направления и рубежи по ходам
    for (let i = 1; i < run.snapshots.length; i++) {
      const c = cs[i], c0 = cs[Math.max(0, i - win)];
      if (!c) continue;
      const from = run.snapshots[i].time, until = run.snapshots[i + 1]?.time ?? addHours(from, ctx.scenario.turnHours);
      // ближайший противник (центр группы того же уровня)
      let enemy: [number, number] | null = null, ed = Infinity;
      for (const [oid, ocs] of cents) {
        if (sideById(oid) === side || !ocs[i]) continue;
        const d = Math.hypot(ocs[i]!.xy[0] - c.xy[0], ocs[i]!.xy[1] - c.xy[1]);
        if (d < ed) { ed = d; enemy = ocs[i]!.xy; }
      }
      type Move = { c0: [number, number]; c: [number, number]; len: number; u: [number, number]; retreat: boolean; w: number; who: string[] };
      const moveOf = (a: C | null, a0: C | null, who: string): Move | null => {
        if (!a || !a0) return null;
        const v: [number, number] = [a.xy[0] - a0.xy[0], a.xy[1] - a0.xy[1]], len = Math.hypot(v[0], v[1]);
        if (len < armyMinKm) return null;
        const u: [number, number] = [v[0] / len, v[1] / len];
        // отход — по положению войск (отходят больше 40 % людей); наступают — удар; иначе — по направлению на противника
        const forward = a.withdraw > 0.4 ? false : a.attack >= 0.3 ? true : enemy ? (enemy[0] - a0.xy[0]) * u[0] + (enemy[1] - a0.xy[1]) * u[1] > 0 : true;
        return { c0: a0.xy, c: a.xy, len, u, retreat: !forward, w: Math.max(1, a.pers), who: [who] };
      };
      let moves: Move[] = [];
      if (level === 'army') {
        const m = moveOf(c, c0, x.g.name);
        if (m && m.len >= minKm) moves = [m];
      } else {
        // главные удары фронта — из ударов его армий: близкие по месту (30 км) и направлению (40°) сливаются в один
        const cands = (armiesOf.get(id) ?? []).map((a) => moveOf(a.cs[i], a.cs[Math.max(0, i - win)], a.g.name)).filter((m): m is Move => !!m).sort((p, q) => q.len - p.len);
        for (const m of cands) {
          const g = moves.find((q) => q.retreat === m.retreat && Math.hypot(q.c[0] - m.c[0], q.c[1] - m.c[1]) <= 30 && q.u[0] * m.u[0] + q.u[1] * m.u[1] >= Math.cos(Math.PI * 40 / 180));
          if (!g) { moves.push({ ...m, who: [...m.who] }); continue; }
          const W = g.w + m.w, mix = (p: [number, number], q: [number, number]): [number, number] => [(p[0] * g.w + q[0] * m.w) / W, (p[1] * g.w + q[1] * m.w) / W];
          g.c0 = mix(g.c0, m.c0); g.c = mix(g.c, m.c); g.len = (g.len * g.w + m.len * m.w) / W; g.w = W; g.who.push(...m.who);
          const um = mix(g.u, m.u), ul = Math.hypot(um[0], um[1]) || 1; g.u = [um[0] / ul, um[1] / ul];
        }
        moves = [...moves.filter((m) => !m.retreat).slice(0, 3), ...moves.filter((m) => m.retreat).slice(0, 2)].filter((m) => m.len >= minKm * 0.6);
      }
      for (const m of moves) {
        const { u, len, retreat } = m;
        // хвост — на линии фронта хода (стрелка крепится к ней), остриё — в глубину на пройденное за окно; линии рядом нет — от прежнего положения
        const at = nearestOnFront(fronts.get(i), m.c, level === 'army' ? 20 : 35);
        const reach = Math.max(len, minKm * 1.2) * (retreat ? 0.8 : 1);
        const tail: [number, number] = at ? at.at : m.c0;
        const head: [number, number] = at ? [tail[0] + u[0] * reach, tail[1] + u[1] * reach] : [m.c[0] + u[0] * len * 0.35, m.c[1] + u[1] * len * 0.35];
        const mid: [number, number] = [(tail[0] + head[0]) / 2, (tail[1] + head[1]) / 2];
        const preset = retreat ? 'inf.retreat' : side === 'own' ? (tank && level === 'army' ? 'inf.tank' : 'inf.attackFade') : 'inf.counter';
        const k = level === 'army' ? (retreat ? 0.8 : 0.55) : (retreat ? 1.1 : 0.95);
        const a = createFeature('arrow', preset, { points: [LL(tail), LL(mid), LL(head)], layerId: `${lay}-moves` }, k, side) as ArrowFeature;
        if (at) a.anchor = { featureId: at.id, t: at.t };
        if (retreat || (side !== 'own' && preset !== 'inf.counter')) recolor(a, side === 'own' ? '#c0392b' : '#1f4e8c');
        const span = win * ctx.scenario.turnHours >= 48 ? `${(win * ctx.scenario.turnHours) / 24} сут` : `${win * ctx.scenario.turnHours} ч`;
        a.name = `${shortName(x.g.name)}: ${retreat ? 'отход' : 'удар'} на ${len.toFixed(len < 10 ? 1 : 0)} км за ${span}${level === 'front' && m.who.length ? ` (${m.who.map(shortName).join(', ')})` : ''}`;
        a.time = { from, to: until };
        out.push(a);
      }
      if (moves.length) continue;
      if (enemy && c.defend >= 0.5 && c.units.length) {
        // рубеж обороны: поперёк направления на противника, по ширине расположения соединений, чуть впереди центра
        const d = Math.hypot(enemy[0] - c.xy[0], enemy[1] - c.xy[1]) || 1;
        const u: [number, number] = [(enemy[0] - c.xy[0]) / d, (enemy[1] - c.xy[1]) / d], nrm: [number, number] = [-u[1], u[0]];
        const proj = c.units.map((m) => (m.xy[0] - c.xy[0]) * nrm[0] + (m.xy[1] - c.xy[1]) * nrm[1]);
        const half = Math.max(minKm * 1.5, (Math.max(...proj) - Math.min(...proj)) / 2 + minKm);
        const off = Math.min(minKm, d * 0.25);
        const ctr: [number, number] = [c.xy[0] + u[0] * off, c.xy[1] + u[1] * off];
        const pts: LngLat[] = [-1, -0.5, 0, 0.5, 1].map((t) => LL([ctr[0] + nrm[0] * half * t - u[0] * Math.abs(t) * half * 0.15, ctr[1] + nrm[1] * half * t - u[1] * Math.abs(t) * half * 0.15]));
        const l = createFeature('line', 'atlas.defense', { points: pts, layerId: `${lay}-moves` }, level === 'army' ? 1.3 : 1.8, side) as LineFeature;
        l.style = { ...l.style, layers: l.style.layers.map((ly) => ({ ...ly, color: side === 'own' ? '#c0392b' : '#1f4e8c' })) };
        l.name = `${shortName(x.g.name)}: оборона`;
        l.time = { from, to: until };
        out.push(l);
      }
    }
  }
  return out;
}
