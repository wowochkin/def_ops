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
export const loadRules = (id: string) => read<Rules>('rules', `${id}.json`);
export const loadTheatre = (id: string) => read<TheatreData>('theatres', `${id}.json`);
export const loadScenario = (id: string) => read<Scenario>('scenarios', `${id}.json`);
export const loadHistory = (id: string) => read<History>('scenarios', `${id}.history.json`);

/** Всё, что нужно для прогона сценария: театр, профили сторон, правила. */
export function loadContext(scenarioId: string, rulesId?: string): SimContext {
  const scenario = loadScenario(scenarioId);
  const profiles = Object.fromEntries(scenario.sides.map((s) => [s.profile, loadProfile(s.profile)]));
  return { scenario, theatre: new Theatre(loadTheatre(scenario.theatre)), profiles, rules: loadRules(rulesId ?? scenario.rules) };
}
