/**
 * Исторический прогон с отчётом: N прогонов (разные seed), сравнение с историей,
 * ключевые события, отчёт в Markdown. Без обращения к файлам — работает и в Node,
 * и в браузере (панель «Переигровка» редактора).
 */
import type { SimContext } from './step';
import { checkEvents, compareWithHistory, runScenario, summarize, type Deviation, type EventResult, type History, type RunResult } from './history';
import { shortName } from './publish';
import { groupOf, sectorViolations } from './sectors';
import type { RunResult as Run } from './history';

export interface AnalysisOptions {
  seed?: number;
  /** Число прогонов (seed, seed+1, …); отчёт и карта — по первому, разброс — по всем. */
  runs?: number;
  /** Допуск, км сверх неопределённости исторического положения. */
  toleranceKm?: number;
  /** Сообщать о ходе расчёта: номер прогона (с 1). */
  onRun?: (k: number, runs: number) => void;
}

export interface Analysis {
  run: RunResult;
  ms: number;
  seed: number;
  toleranceKm: number;
  deviations: Deviation[];
  summary: ReturnType<typeof summarize>;
  /** Доля положений в допуске и медиана превышения по каждому прогону. */
  spread: { seed: number; within: number; median: number }[];
  /** Ключевые события первого прогона. */
  events: EventResult[];
  /** События по всем прогонам: расхождение в сутках (null — не случилось). */
  eventsBySeed: { id: string; title: string; historical: string; days: (number | null)[] }[];
  /** Выходы в полосу соседа по директивам (первый прогон): формирование, линия, ходов, с какого момента. */
  sectors: SectorBreach[];
}

export interface SectorBreach { formation: string; boundary: string; in: string; turns: number; first: string }

/** Выходы формирований в полосу соседа по действующим разграничительным линиям — по снимкам прогона. */
export function sectorBreaches(ctx: SimContext, run: Run): SectorBreach[] {
  if (!ctx.scenario.boundaries?.length) return [];
  const groups = groupOf(ctx.scenario, 'front');
  const side = new Map(run.final.formations.map((f) => [f.id, f.side]));
  const acc = new Map<string, SectorBreach>();
  for (const s of run.snapshots) {
    for (const v of sectorViolations(ctx.theatre, ctx.scenario, s.units.map((u) => ({ id: u.id, side: side.get(u.id) ?? '', at: u.at, destroyed: u.destroyed })), s.time, groups)) {
      const k = `${v.formation}|${v.boundary}`;
      const b = acc.get(k);
      if (b) b.turns++; else acc.set(k, { formation: v.formation, boundary: v.boundary, in: v.in, turns: 1, first: s.time });
    }
  }
  return [...acc.values()].sort((a, b) => a.first.localeCompare(b.first));
}

export function analyze(ctx: SimContext, history: History, o: AnalysisOptions = {}): Analysis {
  const seed = o.seed ?? 1, runs = Math.max(1, o.runs ?? 1), tol = o.toleranceKm ?? 10;
  const t0 = Date.now();
  o.onRun?.(1, runs);
  const run = runScenario(ctx, seed);
  const ms = Date.now() - t0;
  const deviations = compareWithHistory(ctx, run, history);
  const summary = summarize(deviations, tol);
  const events = checkEvents(ctx, run, history);
  const spread = [{ seed, within: summary.within, median: summary.medianExcessKm }];
  const bySeed = events.map((e) => ({ id: e.id, title: e.title, historical: e.historical, days: [e.days] as (number | null)[] }));
  for (let k = 1; k < runs; k++) {
    o.onRun?.(k + 1, runs);
    const r = runScenario(ctx, seed + k);
    const s = summarize(compareWithHistory(ctx, r, history), tol);
    spread.push({ seed: seed + k, within: s.within, median: s.medianExcessKm });
    const ev = checkEvents(ctx, r, history);
    for (const b of bySeed) b.days.push(ev.find((e) => e.id === b.id)?.days ?? null);
  }
  return { run, ms, seed, toleranceKm: tol, deviations, summary, spread, events, eventsBySeed: bySeed, sectors: sectorBreaches(ctx, run) };
}

const fmtDays = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));

/** Отчёт о сравнении с историей (Markdown). */
export function reportMarkdown(ctx: SimContext, a: Analysis): string {
  const { run, summary: sum, spread, toleranceKm: tol } = a;
  const names = new Map(run.final.formations.map((f) => [f.id, shortName(f.name)]));
  const runs = spread.length;
  const L: string[] = [];
  L.push(`# Исторический прогон: ${ctx.scenario.name}`, '');
  L.push(`Сценарий \`${ctx.scenario.id}\`, правила \`${ctx.rules.id}\`, seed ${a.seed}; ходов ${run.final.turn} по ${ctx.scenario.turnHours} ч; расчёт ${a.ms} мс.`, '');
  L.push('Обе стороны получают исторические задачи (наступать на…, держаться, отходить), а не исторические положения: темпы, окружения и исходы боёв считает арбитр. Отклонение — расстояние от расчётного положения до исторического; «сверх» — за вычетом неопределённости исторического положения. Устройство модели — docs/system.md, часть II.', '');
  L.push(`**В пределах ${tol} км сверх неопределённости: ${(sum.within * 100).toFixed(0)} %** положений (${sum.n}); медиана превышения ${sum.medianExcessKm} км.`, '');
  if (runs > 1) {
    const w = spread.map((x) => x.within);
    L.push(`Разброс по ${runs} прогонам (seed ${a.seed}…${a.seed + runs - 1}): доля в допуске ${(Math.min(...w) * 100).toFixed(0)}–${(Math.max(...w) * 100).toFixed(0)} %.`, '');
  }
  if (a.eventsBySeed.length) {
    L.push('## Ключевые события', '');
    if (runs > 1) {
      L.push(`| событие | история | расчёт (seed ${a.seed}) | расхождение по прогонам, сут |`, '|---|---|---|---|');
      for (const e of a.eventsBySeed) {
        const first = a.events.find((x) => x.id === e.id);
        L.push(`| ${e.title} | ${e.historical.slice(5)} | ${first?.simulated?.slice(5) ?? 'не произошло'} | ${e.days.map(fmtDays).join(' ')} |`);
      }
      const all = a.eventsBySeed.flatMap((e) => e.days);
      L.push('', `В пределах ±2 сут: ${all.filter((d) => d != null && Math.abs(d) <= 2).length} из ${all.length}.`);
    } else {
      L.push('| событие | история | расчёт | расхождение, сут |', '|---|---|---|---|');
      for (const e of a.events) L.push(`| ${e.title} | ${e.historical.slice(5)} | ${e.simulated?.slice(5) ?? 'не произошло'} | ${fmtDays(e.days)} |`);
    }
    L.push('');
  }
  if (ctx.scenario.boundaries?.some((b) => b.kind !== 'air')) {
    const bs = ctx.scenario.boundaries.filter((b) => b.kind !== 'air');
    const title = new Map(bs.map((b) => [b.id, b.title]));
    const fname = new Map(ctx.scenario.formations.map((f) => [f.id, shortName(f.name)]));
    L.push('## Разграничительные линии', '', `Линии по директивам (${bs.length}): ${bs.map((b) => `${b.title} (${b.reliability ?? '—'})`).join('; ')}. Где линий нет и за их концами — полосы расчётные (по ближайшим войскам фронтов).`, '');
    if (!a.sectors.length) L.push('Выходов в полосу соседа нет.', '');
    else {
      L.push(`Выходы в полосу соседа (seed ${a.seed}): ${a.sectors.length}.`, '', '| формирование | линия | в полосе | ходов | с |', '|---|---|---|---|---|');
      for (const b of a.sectors) L.push(`| ${names.get(b.formation) ?? b.formation} | ${title.get(b.boundary) ?? b.boundary} | ${fname.get(b.in) ?? b.in} | ${b.turns} | ${b.first.slice(5, 16).replace('T', ' ')} |`);
      L.push('');
    }
  }
  L.push('## По дням', '', '| день | положений | среднее отклонение, км | медиана сверх, км | в допуске |', '|---|---|---|---|---|');
  for (const d of [...sum.byDay].sort((x, y) => x.key.localeCompare(y.key))) L.push(`| ${d.key} | ${d.n} | ${d.meanKm} | ${d.medianExcessKm} | ${(d.within * 100).toFixed(0)} % |`);
  L.push('', '## По формированиям', '', '| формирование | положений | среднее, км | медиана сверх, км | в допуске |', '|---|---|---|---|---|');
  for (const d of [...sum.byFormation].sort((x, y) => x.within - y.within)) L.push(`| ${names.get(d.key) ?? d.key} | ${d.n} | ${d.meanKm} | ${d.medianExcessKm} | ${(d.within * 100).toFixed(0)} % |`);
  L.push('', '## Наибольшие расхождения', '', '| формирование | дата | историческое место | отклонение, км | сверх, км |', '|---|---|---|---|---|');
  for (const d of [...a.deviations].sort((x, y) => y.excessKm - x.excessKm).slice(0, 15)) L.push(`| ${names.get(d.formation)} | ${d.time.slice(0, 10)} | ${d.place} (${d.reliability}, ±${d.approxKm}) | ${d.km} | ${d.excessKm} |`);
  L.push('', '## Бои', '', '| ход | наступающие | обороняющиеся | соотношение | исход | продвижение, км | потери наст./обор., % |', '|---|---|---|---|---|---|---|');
  const OUT: Record<string, string> = { breakthrough: 'прорыв', advance: 'продвижение', repelled: 'отражено', held: 'удержано' };
  for (const j of run.final.journal) {
    if (j.kind !== 'combat') continue;
    L.push(`| ${j.time.slice(5, 10)} | ${j.attackers.map((x) => names.get(x)).join(', ')} | ${j.defenders.map((x) => names.get(x)).join(', ')} | ${j.ratio} | ${OUT[j.outcome] ?? j.outcome} | ${j.advanceKm} | ${(j.attackerLoss * 100).toFixed(1)} / ${(j.defenderLoss * 100).toFixed(1)} |`);
  }
  L.push('', '## Итог по силам', '', '| формирование | люди (нач. → кон.) | танки (нач. → кон.) |', '|---|---|---|');
  for (const f of run.final.formations) L.push(`| ${shortName(f.name)} | ${f.initial.personnel.toLocaleString('ru')} → ${f.personnel.toLocaleString('ru')}${f.destroyed ? ' (разгромлено)' : ''} | ${f.initial.tanks} → ${f.tanks} |`);
  L.push('', '## Оговорки', '',
    '- Задачи сторон записаны составителем по книгам и мемуарам; у каждой — источник в рецепте сценария.',
    '- Численность части объединений и положения с достоверностью C — оценки составителя набора данных.',
    '- Соединение — точка с полосой обороны, а не занимаемый район; местность — современная с историческими поправками (подробно — раздел «Ограничения» в docs/system.md, часть II).');
  return L.join('\n');
}
