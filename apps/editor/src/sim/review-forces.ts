/** Силы для разбора игры: своя сторона раньше противника, армии раньше корпусов, внутри — по исходной численности. */
export function topForces<T extends { side: 'own' | 'enemy'; echelon: string; start: number }>(rows: T[], n = 48): T[] {
  const rank = (e: string) => (e === 'army' ? 0 : 1);
  return [...rows].sort((a, b) => (a.side !== b.side ? (a.side === 'own' ? -1 : 1) : rank(a.echelon) - rank(b.echelon) || b.start - a.start)).slice(0, n);
}
