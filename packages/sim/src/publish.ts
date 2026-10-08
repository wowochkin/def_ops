/**
 * Прогон → карта редактора: знаки формирований с ключевыми кадрами по ходам,
 * линия фронта по ходам, бои за ход (стрелки), исторические положения и линии
 * фронта («призраки») для сравнения, рубежи театра. Всё на шкале времени
 * документа, поэтому прогон смотрится ползунком времени, как обычная карта.
 */
import { createFeature, emptyDocument, type ArrowFeature, type Feature, type Layer, type LngLat, type MapDocument, type Side, type SymbolFeature } from '@def-ops/core';
import { frontLine, territoryLine } from './front';
import { dist } from './geo';
import { checkEvents, type History, type RunResult } from './history';
import { power } from './rules';
import { addHours, onMap, profileOf, type SimContext } from './step';
import type { Formation } from './types';

export interface PublishOptions {
  name?: string;
  /** Какая сторона «свои» (красные). */
  ownSide?: string;
  /** Показывать бои за ход стрелками. */
  combats?: boolean;
  /** Линия фронта рисуется, только где формирования обеих сторон ближе этого, км. */
  frontReachKm?: number;
  /** Наименьшая длина стрелки боя на карте, км. */
  minArrowKm?: number;
}

/** Короткая подпись знака: «8 гв. А», «XI тк СС», «Франкфурт». */
export function shortName(name: string): string {
  const n = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const num = n.match(/^(\d+)-[яй]\s+/)?.[1];
  if (num) {
    const rest = n.slice(n.indexOf(' ') + 1);
    const rules: [RegExp, string][] = [
      [/^гвардейская танковая армия/, 'гв. ТА'], [/^танковая армия/, 'ТА'], [/^ударная армия/, 'УА'],
      [/^гвардейская армия/, 'гв. А'], [/^армия Войска Польского/, 'А ВП'], [/^армия/, 'А'],
      [/^гвардейский танковый корпус/, 'гв. тк'], [/^танковый корпус/, 'тк'], [/^стрелковый корпус/, 'ск'],
    ];
    for (const [re, s] of rules) if (re.test(rest)) return `${num} ${s}`;
    return `${num} ${rest}`;
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

  // формирования: знак с ключевыми кадрами по ходам
  const byId = new Map(run.final.formations.map((f) => [f.id, f]));
  for (const f of run.final.formations) {
    const frames = run.snapshots.map((sn) => ({ t: sn.time, u: sn.units.find((u) => u.id === f.id) })).filter((x) => x.u);
    if (!frames.length) continue;
    const side = sideOf(f.side);
    const preset = tankish(f, ctx) ? 'std.mechCorps' : 'std.unitOval';
    const sym = createFeature('symbol', preset, { at: frames[0].u!.at, layerId: side === 'own' ? 'sim-own' : 'sim-enemy' }, 1, side) as SymbolFeature;
    sym.name = f.name;
    sym.style = { ...sym.style, text: shortName(f.name), textStyle: { font: 'PT Sans Narrow', size: 10, weight: 700, italic: false, color: sym.style.color, halo: { color: '#ffffff', width: 2 }, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.1 } };
    sym.keyframes = frames.map((x) => ({ t: x.t, at: x.u!.at, note: `${x.u!.personnel.toLocaleString('ru')} чел., ${x.u!.tanks} танков; ${POSTURE_RU[x.u!.posture] ?? x.u!.posture}; боеприпасы ${x.u!.ammo ?? '?'} бк${x.u!.cutOff ? '; ОТРЕЗАНО от снабжения' : ''}` }));
    const gone = frames.find((x) => x.u!.destroyed);
    sym.time = { from: f.enterAt ?? null, to: gone ? gone.t : null };
    features.push(sym);
  }

  // линия фронта по ходам
  const sides = ctx.scenario.sides.map((x) => x.id) as [string, string];
  for (let i = 0; i < run.snapshots.length; i++) {
    const sn = run.snapshots[i];
    const to = run.snapshots[i + 1]?.time ?? addHours(sn.time, ctx.scenario.turnHours);
    const units = sn.units.filter((u) => !u.destroyed).map((u) => ({ ...byId.get(u.id)!, position: u.at, personnel: u.personnel, tanks: u.tanks, destroyed: false }))
      .filter((f) => onMap(f, sn.time));
    // территория ведётся — фронт по её границе (сплошная полоса); иначе — изолиния влияния войск
    const terr = sn.territory ?? run.snapshots[i + 1]?.territory;
    const raw = terr ? territoryLine(T, terr) : frontLine(T, units, sides, (f) => power(f, profileOf(ctx, f.side), ctx.rules).total, { sigmaKm: 25 });
    // линия только там, где обе стороны рядом: в глубоком тылу изолиния есть, а фронта нет
    const near = (p: LngLat, side: string) => units.some((u) => u.side === side && dist(T.proj.toXY(u.position), T.proj.toXY(p)) <= o.frontReachKm!);
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
    }
  }

  // бои за ход: у каждого наступающего — стрелка в сторону обороняющихся длиной не меньше minArrowKm,
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
      const len = Math.max(o.minArrowKm!, j.advanceKm);
      for (const id of j.attackers) {
        const a0 = P(pos(id));
        const v: [number, number] = [d[0] - a0[0], d[1] - a0[1]];
        const nrm = Math.hypot(v[0], v[1]) || 1;
        const u: [number, number] = [v[0] / nrm, v[1] / nrm];
        const tail = T.proj.toLL([a0[0] - u[0] * len * 0.35, a0[1] - u[1] * len * 0.35]);
        const head = T.proj.toLL([a0[0] + u[0] * len * 0.65, a0[1] + u[1] * len * 0.65]);
        const side = sideOf(byId.get(id)!.side);
        // объёмные стрелки инфографики: свои — красная, противник — синяя; неудачная атака — тоньше и бледнее
        const arrow = <ArrowFeature>createFeature('arrow', side === 'own' ? 'inf.attackFade' : 'inf.counter', { points: [tail, head], layerId: 'sim-combat' }, j.outcome === 'breakthrough' ? 0.75 : strong ? 0.55 : 0.4, side);
        if (!strong) arrow.style = { ...arrow.style, fill: arrow.style.fill.map((c: { t: number; color: string; opacity: number }) => ({ ...c, opacity: c.opacity * 0.5 })) };
        arrow.time = { from: j.time, to: addHours(j.time, ctx.scenario.turnHours) };
        const outcome = { breakthrough: 'прорыв', advance: 'продвижение', held: 'оборона удержана', repelled: 'атака отбита' }[j.outcome];
        arrow.name = `${shortName(byId.get(id)!.name)} → ${j.defenders.map((x) => shortName(byId.get(x)!.name)).join(', ')}: ${outcome}, соотношение ${j.ratio}, ${j.advanceKm} км`;
        features.push(arrow);
      }
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
