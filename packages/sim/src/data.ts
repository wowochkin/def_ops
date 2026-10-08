/** Пакеты данных движка из каталога data/ (только для Node: сервис, проверки, тесты). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Rules, Scenario, SideProfile, TheatreData } from './types';
import type { History } from './history';
import { Theatre } from './theatre';
import type { SimContext } from './step';

export const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

const read = <T>(...p: string[]) => JSON.parse(readFileSync(join(DATA_DIR, ...p), 'utf8')) as T;
export const loadProfile = (id: string) => read<SideProfile>('profiles', `${id}.json`);
/** Правила; `extends` — взять базовые и переписать поверх указанные поля (вложенные объекты — слиянием). */
export function loadRules(id: string): Rules {
  const r = read<Rules>('rules', `${id}.json`);
  if (!r.extends) return r;
  const base = loadRules(r.extends) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(r)) {
    const b = base[k];
    out[k] = v && b && typeof v === 'object' && typeof b === 'object' && !Array.isArray(v) && !Array.isArray(b) ? { ...b, ...v } : v;
  }
  return out as unknown as Rules;
}
export const loadTheatre = (id: string) => read<TheatreData>('theatres', `${id}.json`);
export const loadScenario = (id: string) => read<Scenario>('scenarios', `${id}.json`);
export const loadHistory = (id: string) => read<History>('scenarios', `${id}.history.json`);

/** Всё, что нужно для прогона сценария: театр, профили сторон, правила. */
export function loadContext(scenarioId: string, rulesId?: string): SimContext {
  const scenario = loadScenario(scenarioId);
  const profiles = Object.fromEntries(scenario.sides.map((s) => [s.profile, loadProfile(s.profile)]));
  return { scenario, theatre: new Theatre(loadTheatre(scenario.theatre)), profiles, rules: loadRules(rulesId ?? scenario.rules) };
}
