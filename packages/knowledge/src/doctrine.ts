/**
 * Доктрина в базе: правила «условие → действие» с числами (вид факта `doctrine`) — группы, ступени, числа правила,
 * правило словами и ключ закрепления.
 */
import type { Claim } from './schema';
import { pinKey } from './resolve';

export type DoctrineClaim = Extract<Claim, { kind: 'doctrine' }>;

/** Группы правил доктрины (как в сводах docs/sources/*-doctrine-1945*.json). */
export const DOCTRINE_GROUPS: Record<string, string> = {
  frontage: 'ширина полос и участков прорыва', echelons: 'построение в эшелоны', depth: 'глубина задач', tempo: 'темп наступления',
  commit: 'ввод вторых эшелонов и подвижных групп', stop: 'остановка и переход к обороне', bypass: 'обход узлов обороны', regroup: 'перегруппировка',
  reserve: 'резервы', artillery: 'артиллерийское наступление', air: 'авиационное обеспечение', layout: 'построение обороны',
  counterattack: 'контратаки и контрудары', withdrawal: 'отход и отвод с первой позиции', reserves: 'резервы обороны', timing: 'сроки',
};

export const DOCTRINE_LEVELS = ['front', 'army', 'corps', 'division'] as const;
export const LEVEL_RU: Record<DoctrineClaim['level'], string> = { front: 'фронт', army: 'армия', corps: 'корпус', division: 'дивизия' };

type Value = number | [number, number];
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Число или пара конечных чисел (диапазон «от–до», «от» не больше «до»); прочее — undefined. */
const valueOf = (x: unknown): Value | undefined => num(x) ? x
  : Array.isArray(x) && x.length === 2 && num(x[0]) && num(x[1]) && x[0] <= x[1] ? [x[0], x[1]] : undefined;

/**
 * Числа правила из свода или извлечения: число или пара (ключ value); словарь — его числа и пары, вложенный словарь —
 * плоскими ключами «ключ.подключ». Строки, null, логические, списки не из двух чисел, пары с «до» меньше «от»
 * (не диапазон, а перечень), глубже одного вложения — отбрасываются. Ничего не осталось — undefined.
 */
export function doctrineValues(raw: unknown): DoctrineClaim['values'] | undefined {
  const out: Record<string, Value> = {};
  const top = valueOf(raw);
  if (top !== undefined) out.value = top;
  else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const x = valueOf(v);
      if (x !== undefined) { out[k] = x; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v))
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) { const y = valueOf(v2); if (y !== undefined) out[`${k}.${k2}`] = y; }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const ru = (n: number) => String(n).replace('.', ',');
/** Число или диапазон правила словами: 0,33; 2–4. */
export const doctrineValueRu = (v: Value): string => Array.isArray(v) ? `${ru(v[0])}–${ru(v[1])}` : ru(v);

/** Правило словами: «Доктрина (нем., корпус, контратаки и контрудары): условие → действие; имя число, имя от–до». */
export function doctrineWords(c: DoctrineClaim): string {
  const head = `Доктрина (${c.side === 'de' ? 'нем.' : 'сов.'}, ${LEVEL_RU[c.level] ?? c.level}, ${DOCTRINE_GROUPS[c.group] ?? c.group})`;
  const body = c.condition ? `${c.condition} → ${c.action}` : c.action;
  const nums = Object.entries(c.values ?? {}).map(([k, v]) => `${k} ${doctrineValueRu(v)}`).join(', ');
  return `${head}: ${body}${nums ? `; ${nums}` : ''}`;
}

/** Ключ закрепления правила доктрины: doctrine|сторона:правило| (без даты). */
export const doctrineKey = (side: 'su' | 'de', rule: string): string => pinKey('doctrine', `${side}:${rule}`, '');
