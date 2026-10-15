/**
 * Отметка сборки данных из базы знаний на результате расчёта: какие поправки операции (edits.kb.compiled) были в
 * данных, когда считали. Отпечаток — хеш собранных поправок (время сборки в него не входит: те же поправки — тот
 * же отпечаток), время сборки и число поправок. Два итога с одним seed и разными отпечатками посчитаны на разных
 * данных — разница может быть только от этого.
 */
import type { CompiledEdits } from '@def-ops/knowledge';
import { norm } from './kb-compile';
import { getEdits } from './userdata';

export interface KbStamp {
  /** Отпечаток собранных поправок (8 шестнадцатеричных знаков). */
  id: string;
  /** Время сборки (ISO). */
  at: string;
  /** Число поправок: цифры формирований, переподчинения, отметки, положения, линии, переправы, события. */
  n: number;
}

/** FNV-1a, 32 бита — короткий устойчивый отпечаток строки. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Число поправок сборки. */
export function kbCount(c: CompiledEdits): number {
  const f = Object.values(c.formations).reduce((a, x) => a + Object.values(x).filter((v) => v !== undefined).length, 0);
  return f + c.changes.length + c.checkpoints.length + c.positions.length + c.boundaries.length + c.crossings.length + c.events.length;
}

/** Отметка по сборке операции; сборки нет — null (данные без поправок базы). */
export function kbStampOf(kb: { compiled: CompiledEdits; at: string } | null | undefined): KbStamp | null {
  return kb ? { id: fnv(norm(kb.compiled)), at: kb.at, n: kbCount(kb.compiled) } : null;
}

/** Отметка нынешней сборки операции (из правок операции). */
export async function kbStamp(opId: string): Promise<KbStamp | null> {
  return kbStampOf((await getEdits(opId)).kb);
}

const two = (n: number) => String(n).padStart(2, '0');
const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
/** Время сборки по часам компьютера: «15.10 14:32». */
export const kbStampTime = (at: string) => { const d = new Date(at); return `${two(d.getDate())}.${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`; };

/** Строка отметки: «данные базы знаний: сборка 3f9a1c2e от 15.10 14:32, 839 поправок». */
export function kbStampText(s: KbStamp | null): string {
  if (!s) return 'данные базы знаний: без сборки (поправок базы нет)';
  return `данные базы знаний: сборка ${s.id} от ${kbStampTime(s.at)}, ${s.n} ${plural(s.n, 'поправка', 'поправки', 'поправок')}`;
}

/** Короткая строка под итогом в окне: «база знаний: сборка 3f9a, 15.10 14:32 · 839 поправок» (начало отпечатка; весь — в подсказке). */
export function kbStampShort(s: KbStamp | null): string {
  return s ? `база знаний: сборка ${s.id.slice(0, 4)}, ${kbStampTime(s.at)} · ${s.n} ${plural(s.n, 'поправка', 'поправки', 'поправок')}` : 'база знаний: без сборки';
}

/** Подсказка к строке отметки. */
export const KB_STAMP_HINT = 'На каких данных посчитан итог: отпечаток собранных из базы знаний поправок операции, время сборки и их число. Разные отпечатки — разные данные: итоги с тем же seed могут различаться только из-за этого.';

/** Одни и те же данные (отметки нет у старых сохранений — неизвестно, undefined). */
export const sameKbStamp = (a: KbStamp | null | undefined, b: KbStamp | null | undefined): boolean | undefined =>
  a === undefined || b === undefined ? undefined : (a?.id ?? null) === (b?.id ?? null);

/** Отчёт Markdown с отметкой сборки — строкой под заголовком. */
export function withKbStamp(md: string, s: KbStamp | null): string {
  const t = kbStampText(s);
  const line = `_${t[0].toUpperCase()}${t.slice(1)}._`;
  const i = md.indexOf('\n');
  return i < 0 ? `${md}\n\n${line}` : `${md.slice(0, i)}\n\n${line}\n\n${md.slice(i).replace(/^\n+/, '')}`;
}
