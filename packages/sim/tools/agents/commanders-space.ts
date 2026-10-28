import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Пространство поиска режима `commanders`: числа commanders.json с `range` (черты и мотивы профилей, состояние, прибавки, веса, пороги, туман). */
export function commandersSpace(file = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/rules/commanders.json')): Record<string, [number, number, 'int'?]> {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const out: Record<string, [number, number, 'int'?]> = {};
  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const o = node as Record<string, unknown>;
    if (typeof o.value === 'number' && Array.isArray(o.range) && o.range.length === 2) {
      const [lo, hi] = o.range as [number, number];
      out[`commanders.${path.join('.')}`] = /Hours$/.test(path[path.length - 1]) ? [lo, hi, 'int'] : [lo, hi];
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
  return out;
}
