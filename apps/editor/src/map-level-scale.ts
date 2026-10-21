/**
 * Масштабы карты по уровням. Рекомендуемые интервалы (рекомендация заказчика): тактический 1:25 000 – 1:50 000,
 * оперативный 1:100 000 – 1:200 000, стратегический 1:200 000 – 1:500 000; точка 1:200 000 — у стратегического
 * (оперативному — всё, что крупнее неё; граница с допуском на округление масштаба на экране, 2 %).
 * При переключении уровня масштаб ставится на 1:50 000 / 1:150 000 / 1:300 000 (`def`).
 */
export type LevelId = 'tac' | 'op' | 'st';

const TOL = 0.02;
/** from — крупнее границы интервала, to — мельче; def — масштаб при переключении уровня; coarse — самый мелкий масштаб, который ещё считается уровнем. */
export const LEVEL_SCALE: Record<LevelId, { from: number; to: number; def: number; coarse: number }> = {
  tac: { from: 25_000, to: 50_000, def: 50_000, coarse: 50_000 },
  op: { from: 100_000, to: 200_000, def: 150_000, coarse: 195_000 },  // 200 000 — уже стратегический
  st: { from: 200_000, to: 500_000, def: 300_000, coarse: 500_000 },
};

const fmt = (n: number) => `1:${n.toLocaleString('ru-RU').replace(/\s/g, ' ')}`;
/** «1:25 000 – 1:50 000». */
export const levelScaleLabel = (l: LevelId): string => `${fmt(LEVEL_SCALE[l].from)} – ${fmt(LEVEL_SCALE[l].to)}`;

/** Масштаб 1:d внутри интервала уровня. */
export function scaleInLevel(l: LevelId, d: number): boolean {
  const r = LEVEL_SCALE[l];
  if (d < r.from * (1 - TOL)) return false;
  return l === 'op' ? d < r.to * (1 - TOL) : d <= r.to * (1 + TOL);
}

/** Уровень, чей интервал содержит масштаб (null — между интервалами: 1:50 000 – 1:100 000 или мельче 1:500 000). */
export function levelOfScale(d: number): LevelId | null {
  return (['tac', 'op', 'st'] as const).find((l) => scaleInLevel(l, d)) ?? null;
}

/** Масштаб, который ставится при переключении на уровень. */
export const levelDefaultScale = (l: LevelId): number => LEVEL_SCALE[l].def;
