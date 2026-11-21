import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical';

export type RandomKey = Readonly<{
  seed: bigint;
  exerciseId: string;
  branchId: string;
  purpose: string;
  ordinal: number;
  algorithmVersion: number;
}>;
export type RandomValue = Readonly<{
  algorithmVersion: number;
  digest: string;
  value: number;
}>;

export function deriveRandom(key: RandomKey): RandomValue {
  if (!Number.isSafeInteger(key.ordinal) || key.ordinal < 0) throw new Error('Порядковый номер случайного ключа должен быть неотрицательным целым');
  if (!Number.isSafeInteger(key.algorithmVersion) || key.algorithmVersion < 1) throw new Error('Нужна версия алгоритма случайности');
  if (!key.exerciseId || !key.branchId || !key.purpose) throw new Error('Случайный ключ неполный');
  const digest = createHash('sha256').update(canonicalJson(key)).digest();
  const value = Number(digest.readBigUInt64BE(0) >> 11n) / 9_007_199_254_740_992;
  return Object.freeze({ algorithmVersion: key.algorithmVersion, digest: digest.toString('hex'), value });
}
