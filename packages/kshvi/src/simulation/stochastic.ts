import { deriveRandom, type RandomKey } from '../events/random';
import type { EpisodeEffects } from './aggregate';

export type StochasticOutcome = Readonly<{ id: string; weight: number; effects: EpisodeEffects }>;
export type StoredRandomKey = Readonly<{
  seed: string;
  exerciseId: string;
  branchId: string;
  purpose: string;
  ordinal: number;
  algorithmVersion: number;
  digest: string;
  value: number;
}>;

export function chooseStochasticOutcome(outcomes: readonly StochasticOutcome[], key: RandomKey) {
  if (outcomes.length === 0) throw new Error('Стохастический расчёт требует варианты исхода');
  let total = 0;
  for (const outcome of outcomes) {
    if (!outcome.id.trim() || !Number.isFinite(outcome.weight) || outcome.weight < 0) throw new Error('Некорректный вес стохастического исхода');
    total += outcome.weight;
  }
  if (total <= 0) throw new Error('Сумма весов стохастических исходов должна быть положительной');
  const random = deriveRandom(key);
  const target = random.value * total;
  let cumulative = 0;
  let selected = outcomes[outcomes.length - 1];
  for (const outcome of outcomes) {
    cumulative += outcome.weight;
    if (target < cumulative) { selected = outcome; break; }
  }
  const storedKey: StoredRandomKey = Object.freeze({
    ...key, seed: `${key.seed}n`, digest: random.digest, value: random.value,
  });
  return { outcome: selected, randomKey: storedKey };
}
