/**
 * Калибровка агентной модели в коридорах нормативов («Моделирование» → «Агентная модель» → «Калибровка»): параметр
 * agents-v0.json с нормативом базы (вход agents.<путь> перечня входов) получает коридор множителя — коридор норматива,
 * делённый на исходное значение параметра (у кривых темпа — значение при 3:1). Множители вне коридора не пробуются;
 * исходное значение вне коридора — старт переносится к ближнему краю.
 */
import type { CompiledRules } from '@def-ops/knowledge';

export type MultRange = [number, number];
const EPS = 1e-9;

/** Коридоры множителей параметров paths (пути в agents-v0.json, без приставки «agents.»); без норматива — нет записи. */
export function agentRanges(paths: string[], b: Pick<CompiledRules, 'provenance'>): Record<string, MultRange> {
  const out: Record<string, MultRange> = {};
  for (const path of paths) {
    const p = b.provenance.find((x) => x.path === `agents.${path}`);
    const v0 = p?.value;
    if (!p?.corridor || v0 == null || !(v0 > 0)) continue;
    const lo = p.corridor[0] / v0, hi = p.corridor[1] / v0;
    if (Number.isFinite(lo) && Number.isFinite(hi)) out[path] = [+Math.min(lo, hi).toPrecision(12), +Math.max(lo, hi).toPrecision(12)];
  }
  return out;
}

export const inRange = (m: number, r?: MultRange) => !r || (m >= r[0] - EPS && m <= r[1] + EPS);

/** Множители вокруг текущего cur (cur × m): в коридоре — пробуются, вне — пропускаются. */
export function trialMultipliers(cur: number, mults: number[], r?: MultRange): { tries: number[]; skipped: number[] } {
  const tries: number[] = [], skipped: number[] = [];
  for (const m of mults) { const x = +(cur * m).toFixed(3); (inRange(x, r) ? tries : skipped).push(x); }
  return { tries, skipped };
}

/** Стартовые множители: исходное значение (×1) вне коридора — ближний край коридора; в коридоре — без поправки. */
export function startMultipliers(keys: string[], ranges: Record<string, MultRange>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const r = ranges[k];
    if (r && !inRange(1, r)) out[k] = 1 < r[0] ? r[0] : r[1];
  }
  return out;
}
