/**
 * Прогон → карта редактора: знаки формирований с ключевыми кадрами по ходам,
 * линия фронта по ходам, бои за ход (стрелки), исторические положения и линии
 * фронта («призраки») для сравнения, рубежи театра. Всё на шкале времени
 * документа, поэтому прогон смотрится ползунком времени, как обычная карта.
 */
import { createFeature, emptyDocument, type AreaFeature, type ArrowFeature, type Feature, type LabelFeature, type Layer, type LineFeature, type LngLat, type MapDocument, type Side, type SymbolFeature, type TextStyle } from '@def-ops/core';
import { frontLine, territoryLine } from './front';
import { TERRAIN_CLASSES } from './types';
import { dist } from './geo';
import { checkEvents, type History, type RunResult, type Snapshot } from './history';
import { power } from './rules';
import { addHours, onMap, profileOf, type SimContext } from './step';
import type { Formation } from './types';
import type { Theatre } from './theatre';
import { visualPath } from './roadnet';
import { areaTitle } from './reports';
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

/** Дата на карте, как в атласах: «25.4». */
const dm = (iso: string) => `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}`;

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
    mk('theatre', 'Театр: рубежи', 'base', 0.8),
    // наведённые переправы — только на тактическом масштабе (на обзорных их знаки сливаются в «молотки»)
    mk('theatre-crossings', 'Театр: наведённые переправы', 'base', 0.8),
    mk('hist-front', 'История: линия фронта', 'front', 0.5),
    mk('hist-units', 'История: положения («призраки»)', 'custom', 0.45),
    mk('sim-front-start', 'Переигровка: передний край на начало', 'front', 0.9),
    mk('sim-front-prev', 'Переигровка: линия фронта сутки назад', 'front', 0.8),
    mk('sim-front', 'Переигровка: линия фронта', 'front'),
    mk('sim-enemy', 'Переигровка: противник', 'enemy'),
    mk('sim-own', 'Переигровка: свои войска', 'friendly'),
    mk('sim-combat', 'Переигровка: бои за ход', 'custom', 0.8, o.combats !== false),
    mk('sim-marks', 'Переигровка: особые отметки', 'custom'),
    mk('sim-pockets', 'Переигровка: котлы (окружённые группировки)', 'custom', 0.9),
    mk('sim-fortress', 'Крепости: обводы по застройке', 'custom', 0.95),
    // разграничительные линии: по директивам (история) и расчётные полосы по уровням карты
    mk('hist-bounds', 'Разграничительные линии: директивы и распоряжения', 'custom', 0.75),
    mk('sim-bounds', 'Переигровка: разграничительные линии фронтов', 'custom', 0.85),
    // уровни обобщения (переключаются в переигровке): оперативный — объединения, стратегический — фронты
    mk('lvl-op-units', 'Оперативный уровень: объединения', 'custom', 1, false),
    mk('lvl-op-moves', 'Оперативный уровень: направления действий', 'custom', 0.85, false),
    mk('lvl-op-bounds', 'Оперативный уровень: полосы фронтов и армий', 'custom', 0.85, false),
    mk('lvl-st-front', 'Стратегический уровень: линия фронта (как в атласе)', 'front', 1, false),
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
    const f = createFeature('symbol', 'std.pontoon', { at: b.at, layerId: 'theatre-crossings' }, 0.8, 'own') as SymbolFeature;
    f.name = b.name;
    f.time = { from: b.openFrom, to: b.destroyedAt ?? null };
    features.push(f);
  }

  // переправы, наведённые сапёрами в ходе расчёта
  for (const c of run.final.crossings ?? []) {
    const f = createFeature('symbol', 'std.pontoon', { at: c.at, layerId: 'theatre-crossings' }, 0.8, sideOf(c.side)) as SymbolFeature;
    f.name = `${c.name} (наведена в расчёте)`;
    f.time = { from: c.openFrom, to: null };
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
      if (gone) {
        // уничтоженное соединение остаётся на месте гибели перечёркнутым крестом (у противника — красным)
        const x = createFeature('symbol', preset, { at: gone.u!.at, layerId: sym.layerId }, 1, side) as SymbolFeature;
        x.name = `${f.name}: уничтожено ${dm(gone.t)}`;
        x.labelRank = (sym.labelRank ?? 0) - 5;
        x.style = { ...sym.style, fill: '#ffffff', cross: { mode: 'x', color: side === 'own' ? '#3b3a36' : '#c0392b' } };
        x.time = { from: gone.t, to: null };
        features.push(x);
      }
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
      // как на картах атласа: исходное положение — с подсветкой на всю операцию, вчерашнее — пунктиром ещё сутки
      if (i === 0) {
        const st = createFeature('line', 'atlas.frontGlow', { points: line, layerId: 'sim-front-start' }, 1, 'own');
        st.time = { from: sn.time, to: null };
        st.name = `Передний край на начало (расчёт, ${dm(sn.time)})`;
        features.push(st);
      }
      // стратегический масштаб — линия фронта как в атласе: красная с оранжевой полосой
      const stl = createFeature('line', 'atlas.frontGlow', { points: line, layerId: 'lvl-st-front' }, 1, 'own') as LineFeature;
      stl.style = { ...stl.style, layers: [{ ...stl.style.layers[0], offset: 2.6, width: 4.5, color: '#f2a65a', opacity: 0.9 }, { ...stl.style.layers[1], width: 2.2 }] };
      stl.time = lf.time;
      stl.name = lf.name;
      features.push(stl);
      const prev = createFeature('line', 'atlas.frontPair', { points: line, layerId: 'sim-front-prev' }, 1, 'own') as LineFeature;
      prev.style = { ...prev.style, layers: prev.style.layers.filter((l) => l.dash).map((l) => ({ ...l, offset: 0, width: 1.3, opacity: 0.75 })) };
      prev.time = { from: addHours(sn.time, 24), to: addHours(to, 24) };
      prev.name = `Линия фронта сутки назад (${dm(sn.time)})`;
      features.push(prev);
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
  features.push(...pocketFeatures(ctx, run, sideOf, o.visible), ...fortressFeatures(ctx, run, sideOf, o.visible, labelK));

  // ключевые пункты на обзорных масштабах — как в атласе: кружок и название (места событий истории)
  const placeIds = new Set((history?.events ?? []).map((ev) => (ev as { place?: string }).place).filter((x): x is string => !!x));
  const placed: { xy: [number, number]; title: string }[] = [];
  for (const id of placeIds) {
    const a = T.area(id);
    const raw = T.data.areas.find((x) => x.id === id);
    if (!a || !raw) continue;
    // название без исходного написания и части города («Берлин, Митте» → «Берлин»); близкие и одноимённые — один раз
    const title = areaTitle(raw.name).replace(/\s*\(.*\)\s*$/, '').split(',')[0].trim();
    const xy = T.proj.toXY(a.center) as [number, number];
    if (placed.some((q) => q.title === title || Math.hypot(q.xy[0] - xy[0], q.xy[1] - xy[1]) < T.cellKm * 6)) continue;
    placed.push({ xy, title });
    for (const lay of ['lvl-op-units', 'lvl-st-units']) {
      const dot = createFeature('symbol', 'atlas.town', { at: a.center, layerId: lay }, 0.8 * labelK, 'neutral') as SymbolFeature;
      dot.name = title;
      dot.labelRank = 2;
      // название — правее кружка (на клетку с небольшим)
      const c = T.proj.toXY(a.center);
      const lb = createFeature('label', 'atlas.city', { at: T.proj.toLL([c[0] + T.cellKm * 1.2, c[1]]), text: title, layerId: lay }, 0.9 * labelK, 'neutral') as LabelFeature;
      lb.style = { ...lb.style, halo: { color: '#fdf8ec', width: 2.5 * labelK } };
      lb.name = areaTitle(raw.name);
      lb.labelRank = 2;
      features.push(dot, lb);
    }
  }

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

/* ------------------------------ котлы и крепости ------------------------------ */

/**
 * Котлы: на каждый ход — куски территории стороны, отрезанные от её основной территории (связной компоненты
 * наибольшей площади) не меньше чем тремя клетками чужой земли и не выходящие к краю театра, если в них есть
 * войска этой стороны и большая часть их людей отрезана от подвоза. Контур — граница
 * куска. Если территория в прогоне не ведётся, — отрезанные от подвоза соединения, сгруппированные по близости
 * (до 12 клеток), в общем контуре. Свои котлы — с красной кромкой, противника — с синей. С туманом войны котлы
 * противника — только где есть обнаруженные соединения.
 */
function pocketFeatures(ctx: SimContext, run: RunResult, sideOf: (s: string) => Side, visible?: PublishOptions['visible']): Feature[] {
  const T = ctx.theatre, out: Feature[] = [];
  const byId = new Map(run.final.formations.map((f) => [f.id, f]));
  const sides = ctx.scenario.sides.map((x) => x.id);
  const { cols, rows } = T;
  const push = (sn: Snapshot, to: string, side: string, ring: LngLat[], ids: string[]) => {
    const sd = sideOf(side);
    const area = createFeature('area', 'atlas.encircled', { points: ring, layerId: 'sim-pockets' }, 1, sd) as AreaFeature;
    if (sd === 'own') area.style = { ...area.style, fill: '#f6d6d2', edge: area.style.edge.map((e) => ({ ...e, color: '#c0392b' })) };
    const pers = sn.units.filter((u) => ids.includes(u.id)).reduce((x, u) => x + u.personnel, 0);
    area.name = `Котёл: ${ids.map((id) => shortName(byId.get(id)!.name)).join(', ')} — ${pers.toLocaleString('ru')} чел.`;
    area.time = { from: sn.time, to };
    out.push(area);
  };
  for (let i = 0; i < run.snapshots.length; i++) {
    const sn = run.snapshots[i];
    const to = run.snapshots[i + 1]?.time ?? addHours(sn.time, ctx.scenario.turnHours);
    const units = sn.units.filter((u) => !u.destroyed && byId.get(u.id) && (sideOf(byId.get(u.id)!.side) === 'own' || !visible || visible(u.id, sn)));
    const terr = sn.territory;
    if (terr) {
      for (let si = 0; si < sides.length; si++) {
        // связные куски территории стороны (по 4 соседям)
        const comp = new Int32Array(cols * rows).fill(-1);
        const parts: { cells: number[]; edge: boolean }[] = [];
        for (let k = 0; k < cols * rows; k++) {
          if (terr[k] !== si || comp[k] >= 0) continue;
          const part = { cells: [k], edge: false };
          comp[k] = parts.length;
          for (let j = 0; j < part.cells.length; j++) {
            const q = part.cells[j], c = q % cols, r = (q - c) / cols;
            if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) part.edge = true;
            for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const cc = c + dc, rr = r + dr;
              if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
              const n = rr * cols + cc;
              if (terr[n] === si && comp[n] < 0) { comp[n] = parts.length; part.cells.push(n); }
            }
          }
          parts.push(part);
        }
        if (parts.length < 2) continue;
        const main = parts.reduce((b, x, j) => (x.cells.length > parts[b].cells.length ? j : b), 0);
        // разрыв до основной территории (в клетках, через любые клетки): острие наступления, оторвавшееся на клетку-две
        // от своей территории, — не котёл; котёл — когда между ним и своими не меньше трёх клеток чужой земли
        const gap = new Int32Array(cols * rows).fill(-1);
        const queue = parts[main].cells.slice();
        for (const q of queue) gap[q] = 0;
        for (let h = 0; h < queue.length; h++) {
          const q = queue[h], c = q % cols, r = (q - c) / cols;
          if (gap[q] >= 4) continue;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const cc = c + dc, rr = r + dr;
            if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
            const n = rr * cols + cc;
            if (gap[n] < 0) { gap[n] = gap[q] + 1; queue.push(n); }
          }
        }
        parts.forEach((part, j) => {
          if (j === main || part.edge) return;
          if (part.cells.some((q) => gap[q] >= 0 && gap[q] <= 3)) return;
          const inside = units.filter((u) => byId.get(u.id)!.side === sides[si] && comp[T.indexOf(u.at)] === j);
          // и по подвозу: большая часть людей в куске отрезана (иначе это ушедшее вперёд острие, а не котёл)
          const all = inside.reduce((x, u) => x + u.personnel, 0), cutP = inside.filter((u) => u.cutOff).reduce((x, u) => x + u.personnel, 0);
          if (!inside.length || cutP * 2 < all) return;
          const ids = inside.map((u) => u.id);
          // контур куска: граница маски «кусок / остальное»
          const mask = Array.from(terr, (_, k) => (comp[k] === j ? 0 : 1));
          const ring = territoryLine(T, mask, 2).reduce<LngLat[]>((b, l) => (l.length > b.length ? l : b), []);
          if (ring.length >= 4) push(sn, to, sides[si], ring, ids);
        });
      }
      continue;
    }
    // без территории — по отрезанным от подвоза
    const link = Math.max(T.cellKm * 12, 3), r = Math.max(T.cellKm * 2.5, 1.2);
    const cut = units.filter((u) => u.cutOff).map((u) => ({ u, f: byId.get(u.id)!, xy: T.proj.toXY(u.at) as [number, number] }));
    const seen = new Set<number>();
    for (let a = 0; a < cut.length; a++) {
      if (seen.has(a)) continue;
      const grp = [a]; seen.add(a);
      for (let j = 0; j < grp.length; j++) for (let b = 0; b < cut.length; b++) {
        if (seen.has(b) || cut[b].f.side !== cut[a].f.side) continue;
        if (Math.hypot(cut[b].xy[0] - cut[grp[j]].xy[0], cut[b].xy[1] - cut[grp[j]].xy[1]) <= link) { seen.add(b); grp.push(b); }
      }
      const ring = hull(grp.flatMap((g) => [...Array(12)].map((_, k) => [cut[g].xy[0] + r * Math.cos((k * Math.PI) / 6), cut[g].xy[1] + r * Math.sin((k * Math.PI) / 6)] as [number, number])));
      push(sn, to, cut[a].f.side, ring.map((p) => T.proj.toLL(p)), grp.map((g) => cut[g].u.id));
    }
  }
  return out;
}

/**
 * Обвод города-крепости по застройке: связные клетки класса «застройка» слоя местности театра вокруг гарнизона
 * (не дальше maxKm) — их контур. Местность театра — по спутниковой съёмке или по историческому слою с карты
 * (раздел «Карты»: застройка с карты РККА или плана города того времени), поэтому обвод идёт по застройке того
 * времени, если такой слой наложен. Застройки рядом нет — null.
 */
export function cityOutline(T: Theatre, at: LngLat, maxKm = 20): LngLat[] | null {
  const urban = TERRAIN_CLASSES.indexOf('urban');
  const i0 = T.indexOf(at);
  if (i0 < 0) return null;
  const c0 = i0 % T.cols, r0 = (i0 - c0) / T.cols, P0 = T.cellCenter(c0, r0);
  const seed: number[] = [];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    const c = c0 + dc, r = r0 + dr;
    if (T.inside(c, r) && T.terrain[r * T.cols + c] === urban) seed.push(r * T.cols + c);
  }
  if (!seed.length) return null;
  const inside = new Uint8Array(T.cols * T.rows);
  for (const i of seed) inside[i] = 1;
  const q = [...seed];
  for (let h = 0; h < q.length; h++) {
    const c = q[h] % T.cols, r = (q[h] - c) / T.cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc, rr = r + dr;
      if (!T.inside(cc, rr)) continue;
      const n = rr * T.cols + cc;
      if (inside[n] || T.terrain[n] !== urban) continue;
      const p = T.cellCenter(cc, rr);
      if (Math.hypot(p[0] - P0[0], p[1] - P0[1]) > maxKm) continue;
      inside[n] = 1; q.push(n);
    }
  }
  // маленький город — обвод на клетку шире застройки (крепостной обвод — по окраинам, а не по центру)
  if (q.length < 8) for (const i of [...q]) {
    const c = i % T.cols, r = (i - c) / T.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (T.inside(c + dc, r + dr)) inside[(r + dr) * T.cols + c + dc] = 1;
  }
  const mask = Array.from(inside, (v) => (v ? 0 : 1));
  const ring = territoryLine(T, mask, 2).reduce<LngLat[]>((b, l) => (l.length > b.length ? l : b), []);
  return ring.length >= 4 ? ring : null;
}

/**
 * Крепости (гарнизоны с «узлом обороны» в профиле — Festung): обвод по застройке города на всех масштабах (слой
 * «Крепости»), пока гарнизон держится; на оперативном и стратегическом — ещё знак города-крепости с названием;
 * павшая крепость — перечёркнута.
 */
function fortressFeatures(ctx: SimContext, run: RunResult, sideOf: (s: string) => Side, visible: PublishOptions['visible'] | undefined, labelK: number): Feature[] {
  const out: Feature[] = [];
  const T = ctx.theatre;
  for (const f of run.final.formations) {
    if (!profileOf(ctx, f.side).unitTypes[f.type]?.bypassable) continue;
    const side = sideOf(f.side);
    const all = run.snapshots.map((sn) => ({ sn, u: sn.units.find((u) => u.id === f.id) })).filter((x) => x.u && (side === 'own' || !visible || visible(f.id, x.sn)));
    if (!all.length) continue;
    const gone = all.find((x) => x.u!.destroyed);
    const colour = side === 'own' ? '#c0392b' : '#1f4e8c';
    // обвод — по положению гарнизона в начале (крепость не движется)
    // в городском масштабе (клетка меньше километра) застроено всё — обвод не рисуется
    const ring = T.cellKm >= 1 ? cityOutline(T, all[0].u!.at, T.cellKm * 11) : null;
    if (ring) {
      const a = createFeature('area', 'atlas.encircled', { points: ring, layerId: 'sim-fortress' }, 1, side) as AreaFeature;
      a.style = { ...a.style, fill: side === 'own' ? '#f6d6d2' : '#d6e4f2', fillOpacity: 0.35,
        edge: a.style.edge.map((e) => ({ ...e, color: colour, width: 2.2, ...(e.ticks ? { ticks: { ...e.ticks, side: 1, length: 4, spacing: 6, width: 1.4 } } : {}) })) };
      a.name = `${f.name}: обвод по застройке${gone ? ` (пала ${dm(gone.sn.time)})` : ''}`;
      a.time = { from: all[0].sn.time, to: gone ? gone.sn.time : null };
      out.push(a);
    }
    for (const lay of ['lvl-op-units', 'lvl-st-units']) {
      const sym = createFeature('symbol', 'atlas.fortCity', { at: all[0].u!.at, layerId: lay }, (ring ? 0.9 : 1.3) * labelK, side) as SymbolFeature;
      sym.style = { ...sym.style, color: colour, text: shortName(f.name), textStyle: { font: 'PT Sans Narrow', size: 11 * labelK, weight: 700, italic: false, color: colour, halo: { color: '#ffffff', width: 2 * labelK }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1 } };
      sym.name = `${f.name}${gone ? ` (пала ${dm(gone.sn.time)})` : ''}`;
      sym.labelRank = 18;
      sym.time = { from: all[0].sn.time, to: null };
      if (gone) {
        sym.time = { from: all[0].sn.time, to: gone.sn.time };
        const x = createFeature('symbol', 'atlas.fortCity', { at: gone.u!.at, layerId: lay }, 1.3 * labelK, side) as SymbolFeature;
        x.style = { ...sym.style, cross: { mode: 'x', color: side === 'own' ? '#3b3a36' : '#c0392b' } };
        x.name = `${f.name}: пала ${dm(gone.sn.time)}`;
        x.time = { from: gone.sn.time, to: null };
        out.push(x);
      }
      out.push(sym);
    }
  }
  return out;
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

/**
 * Дата у острия — размером с подписи знаков карты. Размер умножается на коэффициент стрелки k: оформление
 * стрелки растёт при зуме до ×1,5 от k = 1, и дата вместе с ним остаётся не крупнее подписей.
 */
const dateStyle = (side: Side, k: number): TextStyle => ({ font: 'PT Sans Narrow', size: 11 * k, weight: 700, italic: false, color: side === 'own' ? '#b3261e' : '#1f4e8c', halo: { color: '#ffffff', width: 2 * k }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1 });

/** Перекрасить ось с ромбами (сторона). */
function recolorAxis(st: ArrowFeature['style'], color: string): ArrowFeature['style'] {
  return { ...st, fill: st.fill.map((c) => ({ ...c, color })), headFill: null, decorations: (st.decorations ?? []).map((d) => ({ ...d, fill: d.fill ? color : d.fill })) };
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
  type C = { xy: [number, number]; pers: number; tanks: number; n: number; attack: number; defend: number; withdraw: number; cut: number; units: { xy: [number, number] }[] };
  const centre = (sn: Snapshot, members: string[], side: Side): C | null => {
    const us = sn.units.filter((u) => members.includes(u.id) && !u.destroyed && (side === 'own' || !visible || visible(u.id, sn)) && onMap({ ...byId.get(u.id)!, position: u.at }, sn.time));
    if (!us.length) return null;
    const w = us.reduce((a, u) => a + Math.max(1, u.personnel), 0);
    const xy = us.reduce<[number, number]>((a, u) => { const p = P(u.at), k = Math.max(1, u.personnel) / w; return [a[0] + p[0] * k, a[1] + p[1] * k]; }, [0, 0]);
    const by = (k: string) => us.filter((u) => u.posture === k).reduce((a, u) => a + u.personnel, 0) / w;
    return { xy, pers: us.reduce((a, u) => a + u.personnel, 0), tanks: us.reduce((a, u) => a + u.tanks, 0), n: us.length, attack: by('attack'), defend: by('defend'), withdraw: by('withdraw'), cut: us.filter((u) => u.cutOff).reduce((a, u) => a + u.personnel, 0) / w, units: us.map((u) => ({ xy: P(u.at) })) };
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
      // состояние объединения, как на картах атласа: на марше или в резерве — половина знака заштрихована,
      // разгромлено (осталось меньше половины наибольшей численности или большая часть отрезана и потеряла
      // 45 %) — перечёркнуто; смена — не чаще, чем раз в сутки
      type St = 'normal' | 'reserve' | 'routed';
      let peak = 0, cur: St = 'normal', since = 0;
      const states = frames.map((q, k) => {
        const c = q.c!;
        peak = Math.max(peak, c.pers);
        const want: St = c.pers < peak * 0.5 || (c.cut >= 0.5 && c.pers < peak * 0.55) ? 'routed' : c.attack < 0.2 && c.defend < 0.2 && c.withdraw < 0.2 ? 'reserve' : 'normal';
        if (want !== cur && (cur !== 'routed' || c.pers > peak * 0.75) && (want === 'routed' || k - since >= turnsPerDay || k === 0)) { cur = want; since = k; }
        return cur;
      });
      const segs: { st: St; a: number; b: number }[] = [];
      states.forEach((st, k) => { const g = segs[segs.length - 1]; if (g && g.st === st) g.b = k; else segs.push({ st, a: k, b: k }); });
      for (const [n, sg] of segs.entries()) {
        const fs = frames.slice(sg.a, sg.b + 1);
        const sym = createFeature('symbol', tank ? 'std.mechCorps' : 'std.unitOval', { at: LL(fs[0].c!.xy), layerId: `${lay}-units` }, 1.6, side) as SymbolFeature;
        sym.name = x.g.name + (sg.st === 'routed' ? ' — разгромлено' : sg.st === 'reserve' ? ' — на марше / в резерве' : '');
        sym.labelRank = 20 + (RANK[x.g.echelon] ?? 0);
        sym.style = { ...sym.style, text: shortName(x.g.name), textStyle: { font: 'PT Sans Narrow', size: 13, weight: 700, italic: false, color: sym.style.color, halo: { color: '#ffffff', width: 2.5 }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1 },
          ...(sg.st === 'reserve' ? { hatch: { mode: 'half' as const } } : {}), ...(sg.st === 'routed' ? { cross: { mode: 'slash' as const, color: side === 'own' ? '#3b3a36' : '#c0392b' } } : {}) };
        sym.keyframes = fs.map((q) => ({ t: q.sn.time, at: LL(q.c!.xy), note: note(q.c!) }));
        const nextSeg = segs[n + 1];
        sym.time = { from: fs[0].sn.time, to: nextSeg ? frames[nextSeg.a].sn.time : to };
        out.push(sym);
      }
    } else {
      // фронт — надпись, как на оперативной карте; размер — под исходный масштаб карты (надпись масштабируется с картой)
      const lb = createFeature('label', 'atlas.front', { at: LL(frames[0].c!.xy), text: frontName(x.g.name), layerId: `${lay}-units` }, labelK, side) as LabelFeature;
      lb.style = { ...lb.style, color: side === 'own' ? '#b3261e' : '#1f4e8c', halo: { color: '#ffffff', width: 3 * labelK }, uppercase: true, letterSpacing: 0.5 * labelK };
      lb.name = x.g.name;
      lb.keyframes = frames.map((q) => ({ t: q.sn.time, at: LL(q.c!.xy), note: note(q.c!) }));
      lb.time = { from: frames[0].sn.time, to };
      out.push(lb);
      // армии фронта — подписью, как в атласе («8 гв. А»); танковые — овалом с ромбом и номером под ним
      for (const a of armiesOf.get(id) ?? []) {
        const af = run.snapshots.map((sn, i) => ({ sn, i, c: a.cs[i] })).filter((q) => q.c);
        if (!af.length || a.g.id === x.g.id) continue;
        const members = acting.filter((f) => groupOf(f, tree, 'army').id === a.g.id).map((f) => f.id);
        const tk = members.filter((m) => tankish(byId.get(m)!, ctx)).length * 2 > members.length;
        const al = af[af.length - 1];
        const ato = al.i === run.snapshots.length - 1 ? null : run.snapshots[al.i + 1].time;
        const colour = side === 'own' ? '#b3261e' : '#1f4e8c';
        let ft: SymbolFeature | LabelFeature;
        if (tk) {
          ft = createFeature('symbol', 'atlas.tankArmy', { at: LL(af[0].c!.xy), layerId: `${lay}-units` }, 0.75 * labelK, side) as SymbolFeature;
          ft.style = { ...ft.style, ...(side === 'own' ? {} : { color: colour, fill: '#d6e4f2' }), text: shortName(a.g.name), textStyle: { font: 'PT Sans Narrow', size: 13 * labelK, weight: 700, italic: false, color: colour, halo: { color: '#ffffff', width: 2 * labelK }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1 } };
        } else {
          ft = createFeature('label', side === 'own' ? 'atlas.unit' : 'atlas.enemyUnit', { at: LL(af[0].c!.xy), text: shortName(a.g.name), layerId: `${lay}-units` }, labelK, side) as LabelFeature;
          ft.style = { ...ft.style, halo: { color: '#ffffff', width: 2 * labelK } };
        }
        ft.name = a.g.name;
        ft.labelRank = 15;
        ft.keyframes = af.map((q) => ({ t: q.sn.time, at: LL(q.c!.xy) }));
        ft.time = { from: af[0].sn.time, to: ato };
        out.push(ft);
      }
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
      // танковая армия идёт осью с ромбами (весь пройденный путь), а не стрелкой за сутки
      const axis = level === 'army' && tank, moved = moves.length > 0;
      if (axis) moves = moves.filter((m) => m.retreat);
      // остановка: за следующие сутки центр почти не сместился — на острие черта «рубеж достигнут»
      const ahead = cs[Math.min(run.snapshots.length - 1, i + turnsPerDay)];
      const halted = i + turnsPerDay < run.snapshots.length && !!ahead && Math.hypot(ahead.xy[0] - c.xy[0], ahead.xy[1] - c.xy[1]) < armyMinKm * 0.5;
      type Geo = { m: Move; tail: [number, number]; head: [number, number]; at: ReturnType<typeof nearestOnFront> };
      const geos: Geo[] = moves.map((m) => {
        const { u, len, retreat } = m;
        // хвост — на линии фронта хода (стрелка крепится к ней), остриё — в глубину на пройденное за окно; линии рядом нет — от прежнего положения
        const at = nearestOnFront(fronts.get(i), m.c, level === 'army' ? 20 : 35);
        const reach = Math.max(len, minKm * 1.2) * (retreat ? 0.8 : 1);
        const tail: [number, number] = at ? at.at : m.c0;
        const head: [number, number] = at ? [tail[0] + u[0] * reach, tail[1] + u[1] * reach] : [m.c[0] + u[0] * len * 0.35, m.c[1] + u[1] * len * 0.35];
        return { m, tail, head, at };
      });
      // расходящиеся удары фронта из одного района (хвосты ближе 30 км, направления — на 25–90°) — одна стрелка с ветвью
      const branchOf = new Map<Geo, Geo>();
      if (level === 'front') {
        const fw = geos.filter((g) => !g.m.retreat);
        for (const g of fw) {
          if (branchOf.has(g) || [...branchOf.values()].includes(g)) continue;
          const b = fw.find((h) => h !== g && !branchOf.has(h) && ![...branchOf.values()].includes(h) && Math.hypot(h.tail[0] - g.tail[0], h.tail[1] - g.tail[1]) <= 30
            && (() => { const cos = h.m.u[0] * g.m.u[0] + h.m.u[1] * g.m.u[1]; return cos <= Math.cos(Math.PI * 25 / 180) && cos >= 0; })());
          if (b) branchOf.set(g, b);
        }
      }
      const merged = new Set(branchOf.values());
      const span = win * ctx.scenario.turnHours >= 48 ? `${(win * ctx.scenario.turnHours) / 24} сут` : `${win * ctx.scenario.turnHours} ч`;
      for (const g of geos) {
        if (merged.has(g)) continue;
        const { m, at } = g, { len, retreat } = m;
        const br = branchOf.get(g);
        let tail = g.tail, head = g.head, fork: [number, number] | null = null, bhead: [number, number] | null = null;
        if (br) {
          // ствол — от середины хвостов по общему направлению на половину меньшего из ударов; от развилки
          // каждый удар идёт своим направлением на остаток своей длины (не короче порога)
          tail = [(g.tail[0] + br.tail[0]) / 2, (g.tail[1] + br.tail[1]) / 2];
          const ux = g.m.u[0] + br.m.u[0], uy = g.m.u[1] + br.m.u[1], ul = Math.hypot(ux, uy) || 1;
          const lg = Math.hypot(g.head[0] - g.tail[0], g.head[1] - g.tail[1]), lb = Math.hypot(br.head[0] - br.tail[0], br.head[1] - br.tail[1]);
          const r = 0.5 * Math.min(lg, lb);
          fork = [tail[0] + (ux / ul) * r, tail[1] + (uy / ul) * r];
          head = [fork[0] + g.m.u[0] * Math.max(lg - r, minKm), fork[1] + g.m.u[1] * Math.max(lg - r, minKm)];
          bhead = [fork[0] + br.m.u[0] * Math.max(lb - r, minKm), fork[1] + br.m.u[1] * Math.max(lb - r, minKm)];
        }
        const mid: [number, number] = fork ?? [(tail[0] + head[0]) / 2, (tail[1] + head[1]) / 2];
        // стратегический масштаб — стрелки атласа: клин с вырезом в хвосте и обводкой (свои — розово-красные,
        // противник — сине-жёлтые), отход — тонкой стрелкой; оперативный — стрелки инфографики
        const atlas = level === 'front';
        const preset = atlas ? (retreat ? 'atlas.thin' : side === 'own' ? 'atlas.p2' : 'atlas.german') : retreat ? 'inf.retreat' : side === 'own' ? 'inf.attackFade' : 'inf.counter';
        const k = level === 'army' ? (retreat ? 0.8 : 0.55) : (retreat ? 1.2 : 1.3);
        const a = createFeature('arrow', preset, { points: [LL(tail), LL(mid), LL(head)], layerId: `${lay}-moves` }, k, side) as ArrowFeature;
        if (at && !br) a.anchor = { featureId: at.id, t: at.t };
        if (atlas ? retreat && side !== 'own' : retreat || (side !== 'own' && preset !== 'inf.counter')) recolor(a, side === 'own' ? '#c0392b' : '#1f4e8c');
        // удар, после которого объединение встало, — с чертой вместо наконечника и датой выхода на рубеж
        if (!retreat && halted) { a.tipText = dm(from); a.style = { ...a.style, tip: 'bar', tipTextStyle: dateStyle(side, k) }; }
        if (br) {
          const d1 = Math.hypot(mid[0] - tail[0], mid[1] - tail[1]), d2 = Math.hypot(head[0] - mid[0], head[1] - mid[1]);
          a.branches = [{ t: d1 / (d1 + d2 || 1), points: [LL(bhead!)], ...(halted ? { text: dm(from) } : {}) }];
          // ствол — без растворения: развилка должна быть видна
          a.style = { ...a.style, branchWidth: 0.7, ...(atlas ? {} : { fill: a.style.fill.map((c) => ({ ...c, opacity: Math.max(c.opacity, 0.7) })) }) };
        }
        const who = [...m.who, ...(br?.m.who ?? [])];
        a.name = `${shortName(x.g.name)}: ${retreat ? 'отход' : br ? 'расходящиеся удары' : 'удар'} на ${len.toFixed(len < 10 ? 1 : 0)} км за ${span}${level === 'front' && who.length ? ` (${who.map(shortName).join(', ')})` : ''}${halted && !retreat ? '; далее остановка' : ''}`;
        a.time = { from, to: until };
        out.push(a);
      }
      if (axis && i % turnsPerDay === 0 && i > 0) {
        // даты вдоль оси, как в атласах: где была армия к началу каждых суток — когда она оттуда ушла, до конца операции
        const q = cs[i], p0 = cs[i - turnsPerDay], gone = run.snapshots[i + turnsPerDay]?.time;
        if (q && p0 && gone && Math.hypot(q.xy[0] - p0.xy[0], q.xy[1] - p0.xy[1]) >= minKm) {
          const lb = createFeature('label', 'atlas.date', { at: LL(q.xy), text: dm(from), layerId: `${lay}-moves` }, labelK * 1.2, side) as LabelFeature;
          lb.style = { ...lb.style, color: side === 'own' ? '#b3261e' : '#1f4e8c', halo: { color: '#ffffff', width: 2 * labelK } };
          lb.name = `${shortName(x.g.name)}: ${dm(from)}`;
          lb.labelRank = 1;
          lb.time = { from: gone, to: null };
          out.push(lb);
        }
      }
      if (axis && (i % turnsPerDay === 0 || i === run.snapshots.length - 1)) {
        // ось танковой армии: центры по суткам от начала до этого хода; видна до следующей оси
        const pts: [number, number][] = [];
        for (let j = 0; j <= i; j += turnsPerDay) { const q = cs[j]; if (q && (!pts.length || Math.hypot(q.xy[0] - pts[pts.length - 1][0], q.xy[1] - pts[pts.length - 1][1]) >= minKm)) pts.push(q.xy); }
        if (pts.length && Math.hypot(c.xy[0] - pts[pts.length - 1][0], c.xy[1] - pts[pts.length - 1][1]) >= minKm * 0.5) pts.push(c.xy);
        const L = pts.slice(1).reduce((acc, p, j) => acc + Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]), 0);
        if (pts.length >= 2 && L >= minKm * 2) {
          const a = createFeature('arrow', 'atlas.tankAxis', { points: pts.map(LL), layerId: `${lay}-moves` }, 1, side) as ArrowFeature;
          if (side !== 'own') a.style = { ...recolorAxis(a.style, '#1f4e8c') };
          // остриё оси — у знака армии: черта без даты (даты — вдоль оси)
          if (halted) a.style = { ...a.style, tip: 'bar' };
          a.name = `${shortName(x.g.name)}: ось наступления, ${Math.round(L)} км с начала операции${halted ? '; далее остановка' : ''}`;
          const nx = run.snapshots[Math.min(run.snapshots.length - 1, i + turnsPerDay)];
          a.time = { from, to: i + 1 < run.snapshots.length && nx.time !== from ? nx.time : null };
          out.push(a);
        }
      }
      if (moved) continue;
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

/* ------------------------------ сводная карта операции ------------------------------ */

export interface SummaryOptions {
  name?: string;
  /** Какая сторона «свои» (красные). */
  ownSide?: string;
  /** Число этапов (по умолчанию: 3 для операции от 9 суток, 2 — от 4, иначе 1). */
  stages?: number;
  /** Уже построенная карта переигровки этого прогона (из неё берутся линии фронта) — чтобы не строить заново. */
  base?: MapDocument;
}

/** Стили ударов по этапам, как в атласе: жёлто-красный, розово-красный, бледный. */
const STAGE_PRESETS = ['atlas.p1', 'atlas.p2', 'atlas.p3'];
const ORD = ['1-й', '2-й', '3-й', '4-й', '5-й', '6-й'];

/** Выпуклая оболочка (монотонная цепь). */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/**
 * Сводная карта операции по прогону — одна карта без шкалы времени, как в историческом атласе:
 * этапы операции (поровну по суткам) — свои цвета ударов; линии фронта на рубежах этапов с датами;
 * удары объединений за каждый этап — через их положения по суткам, с датой у острия (у остановившихся — черта);
 * у танковых армий — ромбы на оси; подписи армий и фронтов — у исходного положения; разгромленные группировки
 * противника перечёркнуты, окружённые к концу — в контуре окружения; заголовок и условные обозначения — на карте.
 */
export function summaryToDocument(ctx: SimContext, run: RunResult, history?: History | null, o: SummaryOptions = {}): MapDocument {
  const base = o.base ?? runToDocument(ctx, run, history, { ownSide: o.ownSide, combats: false });
  const T = ctx.theatre, snaps = run.snapshots;
  const own = o.ownSide ?? ctx.scenario.sides[0].id;
  const sideOf = (s: string): Side => (s === own ? 'own' : 'enemy');
  const doc = emptyDocument(base.origin, base.refZoom);
  doc.name = o.name ?? `Сводная карта: ${ctx.scenario.name}`;
  doc.paper = '#fbf5e4';
  const mk = (id: string, name: string, role: Layer['role']): Layer => ({ id, name, role, visible: true, locked: false, opacity: 1 });
  doc.layers = [
    mk('sum-front', 'Линии фронта по этапам', 'front'),
    mk('sum-area', 'Окружения', 'custom'),
    mk('sum-moves', 'Удары по этапам', 'custom'),
    mk('sum-units', 'Объединения и фронты', 'custom'),
    mk('sum-legend', 'Заголовок и условные обозначения', 'labels'),
  ];
  const out: Feature[] = [];
  const P = (p: LngLat) => T.proj.toXY(p), LL = (p: [number, number]) => T.proj.toLL(p);
  const ms = (t: string) => Date.parse(`${t}Z`);
  const turnsPerDay = Math.max(1, Math.round(24 / ctx.scenario.turnHours));
  const minKm = Math.max(T.cellKm * 3, 0.6);

  // этапы: границы — снимки, ближайшие к равным долям операции (по суткам)
  const t0 = ms(snaps[0].time), t1 = ms(snaps[snaps.length - 1].time);
  const days = Math.max(1, Math.round((t1 - t0) / 864e5));
  const n = Math.max(1, Math.min(6, o.stages ?? (days >= 9 ? 3 : days >= 4 ? 2 : 1)));
  const at = (t: number) => snaps.reduce((b, s, i) => (Math.abs(ms(s.time) - t) < Math.abs(ms(snaps[b].time) - t) ? i : b), 0);
  const bounds = [...new Set([...Array(n + 1)].map((_, k) => at(t0 + Math.round(((t1 - t0) * k) / n / 864e5) * 864e5)))];
  const stageText = (s: number) => `${ORD[s] ?? `${s + 1}-й`} этап: ${dm(snaps[bounds[s]].time)}–${dm(snaps[bounds[s + 1]].time)}`;
  const tStyle = (size: number, color: string, weight = 700, italic = false): TextStyle => ({ font: 'PT Sans Narrow', size, weight, italic, color, halo: { color: '#ffffff', width: 2 }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.15 });

  // линии фронта на рубежах этапов: исходная — с подсветкой, промежуточные — пунктиром, итоговая — сплошной
  const fronts = new Map<number, { id: string; xy: [number, number][] }[]>();
  const kmOf = (pts: LngLat[]) => pts.slice(1).reduce((a, p, j) => a + dist(P(pts[j]), P(p)), 0);
  bounds.forEach((b, k) => {
    const pieces = base.features.filter((x) => x.layerId === 'sim-front' && x.time?.from === snaps[b].time) as LineFeature[];
    // дата — один раз, на самом длинном куске линии
    const longest = pieces.reduce<LineFeature | null>((a, f) => (!a || kmOf(f.points) > kmOf(a.points) ? f : a), null);
    for (const f of pieces) {
      const first = k === 0, last = k === bounds.length - 1;
      const l = createFeature('line', first ? 'atlas.frontGlow' : 'atlas.frontPair', { points: f.points, layerId: 'sum-front' }, 1, 'own') as LineFeature;
      if (!first) l.style = { ...l.style, layers: l.style.layers.filter((y) => (last ? !y.dash : !!y.dash)).map((y) => ({ ...y, offset: 0, width: last ? 2.2 : 1.4 })) };
      if (f === longest) l.style = { ...l.style, labels: [{ text: dm(snaps[b].time), at: [k === 0 ? 0.35 : k === bounds.length - 1 ? 0.65 : 0.5], offset: 6, style: tStyle(10, '#b3261e') }] };
      l.name = `Линия фронта ${first ? 'на начало операции' : last ? 'на конец' : `к концу ${ORD[k - 1]} этапа`} (${dm(snaps[b].time)}, расчёт)`;
      out.push(l);
      fronts.set(k, [...(fronts.get(k) ?? []), { id: l.id, xy: f.points.map((q) => P(q) as [number, number]) }]);
    }
  });

  // объединения (армии) и фронты: центры по снимкам
  const tree = new Map<string, Node>(ctx.scenario.formations.map((f) => [f.id, f]));
  for (const f of run.final.formations) if (!tree.has(f.id)) tree.set(f.id, f);
  const byId = new Map(run.final.formations.map((f) => [f.id, f]));
  const acting = run.final.formations.filter((f) => f.type);
  type C = { xy: [number, number]; pers: number; attack: number; withdraw: number; cut: number; units: { xy: [number, number]; cut: boolean }[] };
  const centre = (i: number, members: string[]): C | null => {
    const sn = snaps[i];
    const us = sn.units.filter((u) => members.includes(u.id) && !u.destroyed && onMap({ ...byId.get(u.id)!, position: u.at }, sn.time));
    if (!us.length) return null;
    const w = us.reduce((a, u) => a + Math.max(1, u.personnel), 0);
    const xy = us.reduce<[number, number]>((a, u) => { const p = P(u.at), k = Math.max(1, u.personnel) / w; return [a[0] + p[0] * k, a[1] + p[1] * k]; }, [0, 0]);
    const by = (pred: (u: (typeof us)[number]) => boolean) => us.filter(pred).reduce((a, u) => a + u.personnel, 0) / w;
    return { xy, pers: us.reduce((a, u) => a + u.personnel, 0), attack: by((u) => u.posture === 'attack'), withdraw: by((u) => u.posture === 'withdraw'), cut: by((u) => !!u.cutOff), units: us.map((u) => ({ xy: P(u.at), cut: !!u.cutOff })) };
  };
  const groupsAt = (level: 'army' | 'front') => {
    const g = new Map<string, { g: Node; members: string[] }>();
    for (const f of acting) { const x = groupOf(f, tree, level); const y = g.get(x.id) ?? { g: x, members: [] }; y.members.push(f.id); g.set(x.id, y); }
    return g;
  };
  const last = snaps.length - 1;
  for (const [, x] of groupsAt('army')) {
    const side = sideOf(x.g.side);
    const cs = snaps.map((_, i) => centre(i, x.members));
    const first = cs.findIndex((c) => c);
    if (first < 0) continue;
    const tank = x.members.filter((m) => tankish(byId.get(m)!, ctx)).length * 2 > x.members.length;
    const name = shortName(x.g.name);
    // подпись — у исходного положения
    const lb = createFeature('label', side === 'own' ? 'atlas.unit' : 'atlas.enemyUnit', { at: LL(cs[first]!.xy), text: name, layerId: 'sum-units' }, 1, side) as LabelFeature;
    lb.name = x.g.name;
    out.push(lb);
    // удары по этапам
    for (let s = 0; s + 1 < bounds.length; s++) {
      const b0 = bounds[s], b1 = bounds[s + 1];
      const idx: number[] = [];
      for (let i = b0; i < b1; i += turnsPerDay) idx.push(i);
      idx.push(b1);
      const pts = idx.map((i) => cs[i]).filter((c): c is C => !!c);
      if (pts.length < 2) continue;
      const c0 = pts[0], c1 = pts[pts.length - 1];
      const d = Math.hypot(c1.xy[0] - c0.xy[0], c1.xy[1] - c0.xy[1]);
      // на сводной — только заметные удары: не короче двух порогов (6 клеток)
      if (d < minKm * 2) continue;
      const retreat = pts.reduce((a, c) => a + c.withdraw, 0) / pts.length > 0.4;
      if (retreat && side === 'own') continue;
      // удар — если объединение наступало (в среднем за этап не меньше четверти людей) и шло, а не петляло
      // (смещение — не меньше половины пройденного): перегруппировки и марши в тылу на сводную не выносятся
      const walked = pts.slice(1).reduce((a, c, j) => a + Math.hypot(c.xy[0] - pts[j].xy[0], c.xy[1] - pts[j].xy[1]), 0);
      if (!retreat && (pts.reduce((a, c) => a + c.attack, 0) / pts.length < 0.25 || d < walked * 0.5)) continue;
      // путь — по суточным положениям без мелких шагов; хвост — на линии фронта начала этапа, остриё — чуть впереди центра
      const path: [number, number][] = [];
      for (const c of pts) if (!path.length || Math.hypot(c.xy[0] - path[path.length - 1][0], c.xy[1] - path[path.length - 1][1]) >= minKm) path.push(c.xy);
      if (path.length < 2) path.push(c1.xy);
      const on = nearestOnFront(fronts.get(s), path[0], Math.min(20, minKm * 4));
      if (on) path[0] = on.at;
      const e = path[path.length - 1], p = path[path.length - 2];
      const ul = Math.hypot(e[0] - p[0], e[1] - p[1]) || 1;
      path[path.length - 1] = [e[0] + ((e[0] - p[0]) / ul) * minKm * 1.5, e[1] + ((e[1] - p[1]) / ul) * minKm * 1.5];
      if (path.length === 2) path.splice(1, 0, [(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2]);
      const preset = side === 'own' ? STAGE_PRESETS[s % STAGE_PRESETS.length] : retreat ? 'inf.retreat' : 'atlas.german';
      const k = retreat ? 0.7 : 0.4;
      const a = createFeature('arrow', preset, { points: path.map(LL), layerId: 'sum-moves' }, k, side) as ArrowFeature;
      if (retreat) recolor(a, '#1f4e8c');
      const colour = side === 'own' ? '#c0392b' : '#1f4e8c';
      if (tank && !retreat) a.style = { ...a.style, decorations: [...(a.style.decorations ?? []), { type: 'diamond', at: 0.3, to: 0.8, repeat: 0.25, length: 12, width: 7, fill: colour, stroke: null }] };
      // остановка к концу этапа (или конец операции) — черта «рубеж достигнут»
      const nx = cs[Math.min(last, b1 + turnsPerDay)];
      const halted = b1 === last || (!!nx && Math.hypot(nx.xy[0] - c1.xy[0], nx.xy[1] - c1.xy[1]) < minKm * 0.5);
      if (!retreat) a.style = { ...a.style, ...(halted ? { tip: 'bar' as const } : {}), tipTextStyle: dateStyle(side, 1) };
      if (!retreat) a.tipText = dm(snaps[b1].time);
      a.name = `${name}: ${retreat ? 'отход' : 'удар'}, ${stageText(s)}, ${Math.round(d)} км`;
      out.push(a);
    }
    // разгромлено к концу: меньше половины наибольшей численности или большая часть отрезана и потеряно больше 45 %
    const peak = Math.max(...cs.map((c) => c?.pers ?? 0));
    const fin = cs[last] ?? cs.slice().reverse().find((c) => c);
    if (fin && (fin.pers < peak * 0.5 || (fin.cut >= 0.5 && fin.pers < peak * 0.55))) {
      const sym = createFeature('symbol', side === 'own' ? 'atlas.army' : 'atlas.enemyRouted', { at: LL(fin.xy), layerId: 'sum-units' }, 0.8, side) as SymbolFeature;
      sym.style = { ...sym.style, text: name, ...(side === 'own' ? { cross: { mode: 'slash' as const, color: '#3b3a36' } } : {}) };
      sym.name = `${x.g.name}: разгромлено к ${dm(snaps[last].time)} (${Math.round(fin.pers).toLocaleString('ru')} из ${Math.round(peak).toLocaleString('ru')} чел.)`;
      out.push(sym);
    }
  }

  // окружения к концу: отрезанные соединения противника, сгруппированные по близости (до 25 км)
  const cut = snaps[last].units.filter((u) => u.cutOff && !u.destroyed).map((u) => ({ u, xy: P(u.at) as [number, number] }));
  const seen = new Set<number>();
  for (let i = 0; i < cut.length; i++) {
    if (seen.has(i)) continue;
    const grp = [i]; seen.add(i);
    for (let j = 0; j < grp.length; j++) for (let k = 0; k < cut.length; k++) if (!seen.has(k) && Math.hypot(cut[k].xy[0] - cut[grp[j]].xy[0], cut[k].xy[1] - cut[grp[j]].xy[1]) <= 25) { seen.add(k); grp.push(k); }
    const side = sideOf(byId.get(cut[i].u.id)!.side);
    if (side === 'own' || grp.length < 2) continue;
    const r = Math.max(3, T.cellKm * 2);
    const ring = hull(grp.flatMap((g) => [...Array(10)].map((_, a) => [cut[g].xy[0] + r * Math.cos((a * Math.PI) / 5), cut[g].xy[1] + r * Math.sin((a * Math.PI) / 5)] as [number, number])));
    const area = createFeature('area', 'atlas.encircled', { points: ring.map(LL), layerId: 'sum-area' }, 1, 'enemy');
    area.name = `Окружены к ${dm(snaps[last].time)}: ${grp.map((g) => shortName(byId.get(cut[g].u.id)!.name)).join(', ')}`;
    out.push(area);
  }

  // фронты — крупной надписью у исходного положения
  for (const [, x] of groupsAt('front')) {
    if (RANK[x.g.echelon] < RANK.front) continue;
    const c = centre(0, x.members) ?? centre(snaps.findIndex((_, i) => centre(i, x.members)), x.members);
    if (!c) continue;
    const side = sideOf(x.g.side);
    const lb = createFeature('label', 'atlas.front', { at: LL(c.xy), text: frontName(x.g.name), layerId: 'sum-units' }, 1, side) as LabelFeature;
    lb.style = { ...lb.style, color: side === 'own' ? '#b3261e' : '#1f4e8c', halo: { color: '#ffffff', width: 3 } };
    lb.name = x.g.name;
    out.push(lb);
  }

  // заголовок и условные обозначения — в углах охвата карты
  const all = out.flatMap((f) => ('points' in f && f.points ? f.points : 'at' in f && f.at ? [f.at] : [])) as LngLat[];
  const w = Math.min(...all.map((p) => p[0])), e = Math.max(...all.map((p) => p[0])), s0 = Math.min(...all.map((p) => p[1])), n0 = Math.max(...all.map((p) => p[1]));
  const dy = (n0 - s0) * 0.035, dx = (e - w) * 0.12;
  const title = createFeature('label', 'atlas.front', { at: [w, n0 + dy * 2.2], text: `${ctx.scenario.name.split(':')[0]} — сводная карта переигровки`, layerId: 'sum-legend' }, 1, 'neutral') as LabelFeature;
  title.style = { ...title.style, color: '#2a2a2a', align: 'start', size: 20 };
  title.name = 'Заголовок';
  out.push(title);
  const sub = createFeature('label', 'atlas.town', { at: [w, n0 + dy * 1.1], text: `${dm(snaps[0].time)}–${dm(snaps[last].time)}.${snaps[last].time.slice(0, 4)}; правила ${ctx.rules.id}, seed ${run.final.seed ?? ''}`.replace(/, seed $/, ''), layerId: 'sum-legend' }, 1, 'neutral') as LabelFeature;
  sub.name = 'Подзаголовок';
  out.push(sub);
  const legendRow = (k: number) => s0 - dy * (1.5 + k * 1.3);
  const text = (k: number, t: string) => {
    const l = createFeature('label', 'atlas.town', { at: [w + dx * 1.15, legendRow(k)], text: t, layerId: 'sum-legend' }, 1, 'neutral') as LabelFeature;
    l.style = { ...l.style, italic: false };
    l.name = `Условные обозначения: ${t}`;
    out.push(l);
  };
  let row = 0;
  for (let st = 0; st + 1 < bounds.length; st++, row++) {
    const y = legendRow(row);
    const a = createFeature('arrow', STAGE_PRESETS[st % STAGE_PRESETS.length], { points: [[w, y], [w + dx * 0.5, y], [w + dx, y]], layerId: 'sum-legend' }, 0.4, 'own') as ArrowFeature;
    a.name = `Условные обозначения: ${stageText(st)}`;
    out.push(a);
    text(row, `${stageText(st)} — удары армий, у острия — дата выхода (черта — рубеж достигнут)`);
  }
  const sample = (preset: string, k: number, label: string, pick?: (l: LineFeature) => void) => {
    const y = legendRow(row);
    const l = createFeature('line', preset, { points: [[w, y], [w + dx * 0.5, y], [w + dx, y]], layerId: 'sum-legend' }, 1, 'own') as LineFeature;
    pick?.(l);
    l.name = `Условные обозначения: ${label}`;
    out.push(l);
    text(row, label);
    row++;
    void k;
  };
  sample('atlas.frontGlow', 1, 'линия фронта на начало операции');
  if (bounds.length > 2) sample('atlas.frontPair', 1, 'линия фронта к концу этапа (дата у линии)', (l) => { l.style = { ...l.style, layers: l.style.layers.filter((y) => y.dash).map((y) => ({ ...y, offset: 0, width: 1.4 })) }; });
  sample('atlas.frontPair', 1, 'линия фронта на конец операции', (l) => { l.style = { ...l.style, layers: l.style.layers.filter((y) => !y.dash).map((y) => ({ ...y, offset: 0, width: 2.2 })) }; });
  if (out.some((f) => f.layerId === 'sum-area')) {
    const y = legendRow(row), h = dy * 0.45;
    const ar = createFeature('area', 'atlas.encircled', { points: [[w, y - h], [w + dx, y - h], [w + dx, y + h], [w, y + h]], layerId: 'sum-legend' }, 1, 'enemy');
    ar.name = 'Условные обозначения: окружение';
    out.push(ar);
    text(row++, 'окружённые к концу операции соединения противника');
  }
  doc.features = out;
  // вид и исходный масштаб — по охвату всей карты (с заголовком и легендой) в окне ~800×800: размеры знаков
  // заданы для этого вида, как на листе атласа
  const xs = out.flatMap((f) => ('points' in f && f.points ? f.points : 'at' in f && f.at ? [f.at] : [])) as LngLat[];
  const lw = Math.min(...xs.map((p) => p[0])), le = Math.max(...xs.map((p) => p[0])), ls = Math.min(...xs.map((p) => p[1])), ln = Math.max(...xs.map((p) => p[1]));
  const fit = Math.log2((360 * 800) / (512 * Math.max(le - lw, (ln - ls) / Math.cos((((ln + ls) / 2) * Math.PI) / 180), 0.05)));
  doc.refZoom = +Math.min(base.refZoom + 1, fit).toFixed(1);
  doc.view = { center: [(lw + le) / 2, (ls + ln) / 2], zoom: doc.refZoom, bearing: 0 };
  return doc;
}
