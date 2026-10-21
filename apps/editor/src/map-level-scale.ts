/**
 * Рекомендуемые масштабы карты по уровням (рекомендация заказчика): тактический 1:25 000 – 1:50 000,
 * оперативный 1:100 000 – 1:200 000, стратегический 1:200 000 – 1:500 000. Точка 1:200 000 — у стратегического:
 * оперативному — всё, что крупнее неё (граница с допуском на округление масштаба на экране, 2 %).
 */
export type LevelId = 'tac' | 'op' | 'st';

const TOL = 0.02;
export const LEVEL_SCALE: Record<LevelId, { from: number; to: number; setTo: number }> = {
  tac: { from: 25_000, to: 50_000, setTo: 50_000 },
  op: { from: 100_000, to: 200_000, setTo: 190_000 },  // 200 000 — уже стратегический: оперативный ставится с запасом
  st: { from: 200_000, to: 500_000, setTo: 500_000 },
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

/** Масштаб, на который перейти, чтобы попасть в интервал уровня (ближайший край); null — уже внутри. */
export function scaleTarget(l: LevelId, d: number): number | null {
  if (scaleInLevel(l, d)) return null;
  return d < LEVEL_SCALE[l].from ? LEVEL_SCALE[l].from : LEVEL_SCALE[l].setTo;
}
