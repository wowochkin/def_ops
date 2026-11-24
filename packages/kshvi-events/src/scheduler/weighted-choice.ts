import { createHash } from 'node:crypto';
import type { EventCategory } from '../model/event-template';

export type RandomPurpose = 'attempts' | 'category' | 'target' | 'approval';
export type SchedulerRandomKey = Readonly<{
  algorithmVersion: number;
  seed: string;
  branchId: string;
  snapshotHash: string;
  templateSetVersion: string;
  intervalIndex: number;
  category: EventCategory;
  targetKey: string;
  purpose: RandomPurpose;
  ordinal: number;
}>;
export type RandomDraw = Readonly<{ key: string; digest: string; value: number }>;

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Канонический JSON требует конечные числа');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(item => normalize(item ?? null));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && typeof item !== 'function' && typeof item !== 'symbol')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]);
    return Object.fromEntries(entries);
  }
  throw new Error(`Канонический JSON не поддерживает ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function randomForKey(key: SchedulerRandomKey): RandomDraw {
  if (!Number.isSafeInteger(key.algorithmVersion) || key.algorithmVersion < 1) throw new Error('Нужна версия алгоритма случайности');
  if (!Number.isSafeInteger(key.intervalIndex) || key.intervalIndex < 0) throw new Error('Некорректный интервал случайного ключа');
  if (!Number.isSafeInteger(key.ordinal) || key.ordinal < 0) throw new Error('Некорректный порядковый номер случайного ключа');
  if (!key.seed || !key.branchId || !key.snapshotHash || !key.templateSetVersion || !key.targetKey) {
    throw new Error('Случайный ключ неполный');
  }
  const serialized = canonicalJson(key);
  const digestBuffer = createHash('sha256').update(serialized).digest();
  return {
    key: serialized,
    digest: digestBuffer.toString('hex'),
    value: Number(digestBuffer.readBigUInt64BE(0) >> 11n) / 9_007_199_254_740_992,
  };
}

export type PoissonDraw = Readonly<{ count: number; lambda: number; key: string; drawKeys: readonly string[] }>;

/** Сумма независимых Poisson-частей сохраняет точное распределение и ограничивает цикл Кнута. */
export function drawPoisson(lambda: number, key: SchedulerRandomKey): PoissonDraw {
  if (!Number.isFinite(lambda) || lambda < 0) throw new Error('λ должно быть конечным неотрицательным числом');
  const drawKeys: string[] = [];
  if (lambda === 0) return { count: 0, lambda, key: canonicalJson(key), drawKeys };
  let remaining = lambda;
  let count = 0;
  let sampleOrdinal = 0;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 30);
    const threshold = Math.exp(-chunk);
    let product = 1;
    let chunkDraws = 0;
    do {
      const ordinal = key.ordinal * 1_000_000 + sampleOrdinal;
      if (!Number.isSafeInteger(ordinal)) throw new Error('Слишком большой порядковый номер потока');
      const draw = randomForKey({ ...key, ordinal });
      drawKeys.push(draw.digest);
      product *= draw.value;
      chunkDraws += 1;
      sampleOrdinal += 1;
      if (chunkDraws > 100_000) throw new Error('Превышен технический предел розыгрыша Poisson');
    } while (product > threshold);
    count += chunkDraws - 1;
    remaining -= chunk;
  }
  return { count, lambda, key: canonicalJson(key), drawKeys };
}

export type WeightedItem<T> = Readonly<{ id: string; value: T; weight: number }>;
export type WeightedChoice<T> = Readonly<{
  item: T;
  selectedId: string;
  roll: number;
  totalWeight: number;
  orderedIds: readonly string[];
}>;

export function weightedChoice<T>(items: readonly WeightedItem<T>[], unit: number): WeightedChoice<T> | null {
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new Error('Случайная величина взвешенного выбора должна быть в [0; 1)');
  const ordered = [...items].sort((left, right) => left.id.localeCompare(right.id));
  const totalWeight = ordered.reduce((sum, item) => {
    if (!Number.isFinite(item.weight) || item.weight < 0) throw new Error('Вес кандидата должен быть конечным неотрицательным числом');
    return sum + item.weight;
  }, 0);
  if (totalWeight <= 0) return null;
  const roll = unit * totalWeight;
  let cumulative = 0;
  for (const item of ordered) {
    cumulative += item.weight;
    if (roll < cumulative) {
      return { item: item.value, selectedId: item.id, roll, totalWeight, orderedIds: ordered.map(candidate => candidate.id) };
    }
  }
  const last = ordered.at(-1) as WeightedItem<T>;
  return { item: last.value, selectedId: last.id, roll, totalWeight, orderedIds: ordered.map(candidate => candidate.id) };
}
