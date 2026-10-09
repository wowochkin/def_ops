/**
 * Загрузка пакетов данных из любого хранилища (файлы в Node, модули сборки в браузере):
 * функция get(kind, file) возвращает разобранный JSON. Правила с `extends` достраиваются.
 */
import type { Rules, Scenario, SideProfile, TheatreData } from './types';
import type { History } from './history';
import { Theatre } from './theatre';
import type { SimContext } from './step';

import { applyInfrastructure, type InfraRecord } from './infrastructure';

/** infrastructure — сведения о состоянии инфраструктуры операции (по id сценария); необязательны. */
export type DataKind = 'scenarios' | 'theatres' | 'profiles' | 'rules' | 'infrastructure';
export type DataGetter = (kind: DataKind, file: string) => unknown | Promise<unknown>;

/** Правила поверх базовых: поля переписываются, вложенные объекты — слиянием. */
export function mergeRules(base: Rules, over: Partial<Rules>): Rules {
  const b = base as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };
  for (const [k, v] of Object.entries(over)) {
    const x = b[k];
    out[k] = v && x && typeof v === 'object' && typeof x === 'object' && !Array.isArray(v) && !Array.isArray(x) ? { ...x, ...v } : v;
  }
  return out as unknown as Rules;
}

export async function rulesFrom(get: DataGetter, id: string): Promise<Rules> {
  const r = (await get('rules', `${id}.json`)) as Rules;
  return r.extends ? mergeRules(await rulesFrom(get, r.extends), r) : r;
}

/** Контекст прогона и ожидаемая история сценария. */
export async function contextFrom(get: DataGetter, scenarioId: string, rulesId?: string): Promise<{ ctx: SimContext; history: History }> {
  const scenario = (await get('scenarios', `${scenarioId}.json`)) as Scenario;
  const history = (await get('scenarios', `${scenarioId}.history.json`)) as History;
  const profiles: Record<string, SideProfile> = {};
  for (const s of scenario.sides) profiles[s.profile] ??= (await get('profiles', `${s.profile}.json`)) as SideProfile;
  // сведения об инфраструктуре операции — поверх театра (нет — театр как есть)
  const infra = await (async () => { try { return (await get('infrastructure', `${scenarioId}.json`)) as { records?: InfraRecord[] } | null; } catch { return null; } })();
  const theatre = new Theatre(applyInfrastructure((await get('theatres', `${scenario.theatre}.json`)) as TheatreData, infra?.records));
  return { ctx: { scenario, theatre, profiles, rules: await rulesFrom(get, rulesId ?? scenario.rules) }, history };
}
