/**
 * Масштабы карты по уровням — по ступеням командования: Ставка 1:1 000 000, фронт 1:500 000, армия 1:200 000,
 * корпус 1:100 000, дивизия 1:50 000 (масштаб при переключении — `def`). Интервалы смыкаются: граница принадлежит
 * более мелкому уровню (допуск на округление масштаба на экране — 2 %).
 */
export type LevelId = 'stavka' | 'front' | 'army' | 'corps' | 'division';
/** От мелкого масштаба к крупному. */
export const LEVELS: LevelId[] = ['stavka', 'front', 'army', 'corps', 'division'];

const TOL = 0.02;
/** from — крупнее границы интервала, to — мельче; def — масштаб при переключении уровня; coarse — самый мелкий масштаб, который ещё считается уровнем. */
export const LEVEL_SCALE: Record<LevelId, { from: number; to: number; def: number; coarse: number }> = {
  stavka: { from: 700_000, to: 1_500_000, def: 1_000_000, coarse: 1_500_000 },
  front: { from: 350_000, to: 700_000, def: 500_000, coarse: 680_000 },
  army: { from: 150_000, to: 350_000, def: 200_000, coarse: 340_000 },
  corps: { from: 75_000, to: 150_000, def: 100_000, coarse: 145_000 },
  division: { from: 25_000, to: 75_000, def: 50_000, coarse: 72_000 },
};

const fmt = (n: number) => `1:${n.toLocaleString('ru-RU').replace(/\s/g, ' ')}`;
/** «1:25 000 – 1:75 000». */
export const levelScaleLabel = (l: LevelId): string => `${fmt(LEVEL_SCALE[l].from)} – ${fmt(LEVEL_SCALE[l].to)}`;

/** Масштаб 1:d внутри интервала уровня. */
export function scaleInLevel(l: LevelId, d: number): boolean {
  const r = LEVEL_SCALE[l];
  if (d < r.from * (1 - TOL)) return false;
  return l === 'stavka' ? d <= r.to * (1 + TOL) : d < r.to * (1 - TOL);
}

/** Уровень, чей интервал содержит масштаб (null — крупнее 1:25 000 или мельче 1:1 500 000). */
export function levelOfScale(d: number): LevelId | null {
  return LEVELS.find((l) => scaleInLevel(l, d)) ?? null;
}

/** Уровень карты по ступени штаба: на нём штаб виден вместе с подчинёнными. */
export const ECHELON_LEVEL: Record<string, LevelId> = { high_command: 'stavka', front: 'front', army: 'army', corps: 'corps', division: 'division' };
/** «Показать штаб на карте» без keep: уровень — ступень, пунктом которой штаб стал (post.choose), иначе по эшелону, иначе прежний. */
export const hqMapLevel = (chosen: LevelId | null, echelon: string, level: LevelId): LevelId => chosen ?? ECHELON_LEVEL[echelon] ?? level;

/** Масштаб, который ставится при переключении на уровень. */
export const levelDefaultScale = (l: LevelId): number => LEVEL_SCALE[l].def;

/**
 * Уровень из сохранённого значения. Прежние три уровня — по содержанию карты: тактический (дивизии и бои) →
 * «Дивизия», оперативный (армии) → «Фронт», стратегический (фронты) → «Ставка»; неизвестное — «Дивизия».
 */
/** Ключ уровня карты в окне; прежний ключ (def_ops.mapLevel) читают версии с тремя масштабами — туда пишется их значение. */
export const LEVEL_KEY = 'def_ops.mapLevel5';
export const LEGACY_LEVEL_KEY = 'def_ops.mapLevel';
/** Уровень в значение прежних версий (тактический, оперативный, стратегический): переключившись на них, окно не падает. */
export const legacyLevel = (l: LevelId): 'tac' | 'op' | 'st' => (l === 'stavka' ? 'st' : l === 'front' || l === 'army' ? 'op' : 'tac');
export function migrateLevel(v: string | null | undefined): LevelId {
  const old: Record<string, LevelId> = { tac: 'division', op: 'front', st: 'stavka' };
  return v && (LEVELS as string[]).includes(v) ? v as LevelId : (v && old[v]) || 'division';
}
