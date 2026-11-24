import { HttpError } from '@def-ops/service-kit';
import { weatherAtOperational, type EnvironmentSnapshot, type OperationalWeather, type WeatherQuery } from '../../../../packages/kshvi/src/environment/provider';
import type { ScheduledWeatherChange } from '../../../../packages/kshvi/src/commands/conduct';
import type { WorldState } from '../../../../packages/kshvi/src/model/world';
import type { CartographyEnvironmentProvider } from '../environment/cartography-provider';

export async function weatherAtConductWorld(
  world: WorldState,
  provider: CartographyEnvironmentProvider,
  query: WeatherQuery,
): Promise<OperationalWeather & Readonly<{ changeId?: string; supersedes?: string }>> {
  const current = world.state.Weather as { snapshot?: EnvironmentSnapshot; changes?: readonly ScheduledWeatherChange[] };
  if (!current.snapshot) throw new HttpError(409, 'environment_not_bound', 'Исходная среда не привязана к сеансу');
  const change = (current.changes ?? []).filter(candidate => Date.parse(candidate.effectiveAt) <= Date.parse(query.operationalAt)).at(-1);
  if (!change) return provider.weatherAtOperational(current.snapshot, query);
  const resolved = weatherAtOperational({
    mode: 'scenario', contentRef: null, sourceId: change.changeId,
    attribution: `Плановое изменение: ${change.reason}`, license: 'Сценарные данные учения', scenario: change.scenario,
  }, query);
  return { ...resolved, changeId: change.changeId, supersedes: change.supersedes };
}
