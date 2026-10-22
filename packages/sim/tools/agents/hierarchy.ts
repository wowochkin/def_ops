/**
 * Цепочка штабов сценария агентной модели: верхняя инстанция стороны → фронт (группа армий) → армия → корпус;
 * проверка, что у каждой дивизии цепочка доходит до верхней инстанции своей стороны.
 */

export type HqEchelon = 'high_command' | 'front' | 'army' | 'corps';
export interface ScenHq { id: string; name: string; side: 'su' | 'de'; echelon: HqEchelon; parent: string | null }

/** Верхние инстанции сторон. */
export const HIGH_COMMAND: Record<'su' | 'de', { id: string; name: string }> = {
  su: { id: 'su_stavka', name: 'Ставка ВГК' },
  de: { id: 'de_hc', name: 'Верховное командование вермахта (ОКХ; с 25.04.1945 — ОКВ)' },
};

const RANK: Record<HqEchelon, number> = { high_command: 4, front: 3, army: 2, corps: 1 };

/** Замечания по цепочке штабов — по одному на строку, пусто — цепочка полная. */
export function hierarchyProblems(hqs: ScenHq[], divisions: { id: string; side: string; hq: string }[]): string[] {
  const by = new Map(hqs.map((h) => [h.id, h]));
  const out: string[] = [];
  for (const d of divisions) {
    const h = by.get(d.hq);
    if (!h) out.push(`дивизия ${d.id}: нет штаба ${d.hq}`);
    else if (h.side !== d.side) out.push(`дивизия ${d.id}: штаб ${d.hq} другой стороны`);
  }
  for (const h of hqs) {
    if (h.parent == null) {
      if (h.echelon !== 'high_command' || h.id !== HIGH_COMMAND[h.side].id) out.push(`штаб ${h.id}: нет старшего, а он не верхняя инстанция стороны`);
      continue;
    }
    const p = by.get(h.parent);
    if (!p) { out.push(`штаб ${h.id}: нет старшего ${h.parent}`); continue; }
    if (p.side !== h.side) out.push(`штаб ${h.id}: старший ${p.id} другой стороны`);
    if (RANK[p.echelon] <= RANK[h.echelon]) out.push(`штаб ${h.id}: старший ${p.id} не старше по ступени (${p.echelon} над ${h.echelon})`);
    const seen = new Set<string>([h.id]);
    for (let x: ScenHq | undefined = p; x; x = x.parent ? by.get(x.parent) : undefined) {
      if (seen.has(x.id)) { out.push(`штаб ${h.id}: цикл подчинения через ${x.id}`); break; }
      seen.add(x.id);
    }
  }
  return out;
}
