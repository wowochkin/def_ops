import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Пространство поиска режима `commanders`: числа commanders.json с `range` (черты и мотивы профилей, состояние, прибавки, веса, пороги, туман). */
export function commandersSpace(file = FILE): Record<string, [number, number, 'int'?]> {
  const out: Record<string, [number, number, 'int'?]> = {};
  walkRanges(file, (key, value, [lo, hi]) => { out[key] = /Hours$/.test(key) ? [lo, hi, 'int'] : [lo, hi]; void value; });
  return out;
}

/** Нынешние значения тех же чисел: от них отсчитывается второй этап перебора (--around) по ключам вне первого. */
export function commandersValues(file = FILE): Record<string, number> {
  const out: Record<string, number> = {};
  walkRanges(file, (key, value) => { out[key] = value; });
  return out;
}

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/rules/commanders.json');

function walkRanges(file: string, visit: (key: string, value: number, range: [number, number]) => void) {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const o = node as Record<string, unknown>;
    if (typeof o.value === 'number' && Array.isArray(o.range) && o.range.length === 2) {
      visit(`commanders.${path.join('.')}`, o.value, o.range as [number, number]);
      return;
    }
    for (const [k, v] of Object.entries(o)) walk(v, [...path, k]);
  };
  for (const root of ['profiles', 'mood', 'gains', 'weights', 'options', 'fog']) {
    const n = doc[root] as Record<string, unknown> | undefined;
    if (!n) continue;
    if (root !== 'profiles') { walk(n, [root]); continue; }
    for (const [id, p] of Object.entries(n)) for (const part of ['traits', 'motives']) walk((p as Record<string, unknown>)[part], ['profiles', id, part]);
  }
}
