/** Арбитр: боевой потенциал и таблицы исхода боя. Числа — из правил и профилей (калибровка). */
import type { Formation, Rules, SideProfile, Table } from './types';

/** Значение таблицы; по соотношению сил — интерполяция в логарифмической шкале. */
export function interp(table: Table, x: number, logScale = true): number {
  if (!table.length) return 0;
  const f = (v: number) => (logScale ? Math.log(Math.max(v, 1e-6)) : v);
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      const t = (f(x) - f(x0)) / (f(x1) - f(x0));
      return y0 + (y1 - y0) * t;
    }
  }
  return table[table.length - 1][1];
}

/** Составляющие силы — для объяснения исхода («почему так»). */
export interface PowerBreakdown {
  base: number;
  quality: number;
  supply: number;
  fatigue: number;
  total: number;
}

export function power(f: Formation, profile: SideProfile, rules: Rules): PowerBreakdown {
  const w = profile.weights;
  const base = (f.personnel / 1000) * w.personnel + f.tanks * w.tanks + f.guns * w.guns;
  const type = profile.unitTypes[f.type];
  const quality = type?.quality ?? 1;
  let supply = 1;
  if (f.ammo < 0.5) supply *= rules.ammoShort + (1 - rules.ammoShort) * (f.ammo / 0.5);
  if (type && type.mobility !== 'foot' && f.fuel <= 0) supply *= rules.fuelOut;
  const fatigue = 1 - f.fatigue * rules.fatigueEffect;
  return { base, quality, supply, fatigue, total: base * quality * supply * fatigue };
}
