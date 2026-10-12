/**
 * Немецкие силы вне дивизий для сценариев агентной модели (docs/sources/berlin-1945-german-forces.json).
 *
 * 9 А на 1.04.1945 (Lakowski, DRZW 10/1, S. 607, A): боевая численность (Kampfstärke) 74 703, из них дивизии и
 * крепости — 49 009, части вне дивизий (Fecht-Truppe, 66 частей) — 25 694. Остальное до «около 200 тыс.» — небоевой
 * состав, боевыми агентами не добавляется. Части вне дивизий у каждого корпуса 9 А — один агент «части усиления»:
 * - численность — 25 694 минус агенты вне дивизий, уже стоящие в сценарии (бригады штурмовых орудий, боевые
 *   группы), поровну между корпусами пропорционально боевой численности их дивизий (C);
 * - бронетехника — 195 исправных машин вне нумерованных дивизий на 7.04 (B) минус уже стоящие в сценарии, так же;
 * - орудия — зенитные в наземной обороне (695 из 2 625 стволов на 13.04, B) и батареи армейской артиллерии
 *   РГК 404, 406, 408 (41 батарея по Bahm, B; по 4 ствола — допущение), так же;
 * - положение — вторая позиция в 8 км за центром дивизий корпуса в сторону Берлина (учебные и запасные части
 *   ставились во вторую позицию в 8–10 км за главной линией, A; направление — допущение).
 * Крепость Франкфурт — 9 039 боевых (17.03, A), 12 батарей и 39 ПТО 88 мм (≈87 орудий, B), 24 Jagdpanzer 38 (A).
 * Гитлерюгенд-истребители танков — 2 000 у Бескова и Шторкова (A).
 */
type LngLat = [number, number];
export interface Agent { id: string; name: string; side: 'su' | 'de'; hq: string; kind: string; mobility: 'foot' | 'motor' | 'tracked'; size: 'rifle' | 'tank' | 'other'; quality: number; personnel: number; tanks: number; guns: number; ammo: number; fuel: number; pos: LngLat; notes: string[] }

export const NINTH_ARMY_CORPS = ['de_ci', 'de_lvi', 'de_xi_ss'];
const FECHT_TRUPPE = 25694;
const ARMOR_OUTSIDE = 195;
const GUNS_OUTSIDE = 695 + 41 * 4;
const BERLIN: LngLat = [13.4, 52.52];
const KX = 111.32 * Math.cos((52.5 * Math.PI) / 180), KY = 110.57;
const DIVISION = new Set(['div', 'inf_div', 'pzgr_div', 'pz_div', 'fj_div', 'ss_pzgr_div']);

/** Крепость Франкфурт: численность, орудия и бронетехника по источникам (если агент есть в сценарии). */
export function fixFrankfurt(out: Agent[]): void {
  const f = out.find((o) => o.id === 'de_ffo');
  if (!f) return;
  Object.assign(f, { personnel: 9039, guns: 87, tanks: 24 });
  f.notes = f.notes.filter((n) => !n.startsWith('численность')).concat('численность: Kampfstärke 9 039 на 17.03 (Lakowski, A); 12 батарей и 39 ПТО 88 мм, 24 Jagdpanzer 38 (A/B) — berlin-1945-german-forces.json');
}

/** Части усиления корпусов 9 А и гитлерюгенд-истребители танков — новые агенты. */
export function reinforcements(out: Agent[], hqName: (id: string) => string): Agent[] {
  const ninth = out.filter((o) => o.side === 'de' && NINTH_ARMY_CORPS.includes(o.hq));
  const divs = ninth.filter((o) => DIVISION.has(o.kind));
  const extra = ninth.filter((o) => !DIVISION.has(o.kind));
  const pers = Math.max(0, FECHT_TRUPPE - extra.reduce((s, o) => s + o.personnel, 0));
  const armor = Math.max(0, ARMOR_OUTSIDE - extra.reduce((s, o) => s + o.tanks, 0));
  const total = divs.reduce((s, o) => s + o.personnel, 0) || 1;
  const res: Agent[] = [];
  for (const corps of NINTH_ARMY_CORPS) {
    const cd = divs.filter((o) => o.hq === corps);
    if (!cd.length) continue;
    const share = cd.reduce((s, o) => s + o.personnel, 0) / total;
    const c = cd.reduce<LngLat>((s, o) => [s[0] + o.pos[0] / cd.length, s[1] + o.pos[1] / cd.length], [0, 0]);
    const v: LngLat = [(BERLIN[0] - c[0]) * KX, (BERLIN[1] - c[1]) * KY];
    const l = Math.hypot(v[0], v[1]) || 1;
    const pos: LngLat = [+(c[0] + (v[0] / l) * 8 / KX).toFixed(4), +(c[1] + (v[1] / l) * 8 / KY).toFixed(4)];
    res.push({
      id: `${corps}_reinf`, name: `части усиления ${hqName(corps)} (вне дивизий)`, side: 'de', hq: corps, kind: 'reinf',
      mobility: 'foot', size: 'other', quality: 0.8,
      personnel: Math.round(pers * share), tanks: Math.round(armor * share), guns: Math.round(GUNS_OUTSIDE * share), ammo: 1, fuel: 1, pos,
      notes: [
        'положение: вторая позиция в 8 км за дивизиями корпуса (A — учебные и запасные части; направление — допущение)',
        `численность: часть 25 694 боевых вне дивизий 9 А на 1.04 (Lakowski, A) за вычетом агентов вне дивизий, пропорционально дивизиям корпуса (C)`,
        'бронетехника и орудия: 195 машин вне дивизий на 7.04 (B), зенитные в наземной обороне 695 (B) и 41 батарея РГК по 4 ствола (допущение) — пропорционально (C)',
        'качество 0,8 — допущение (сборные и тыловые части)',
      ],
    });
  }
  const hj = ninth.length ? [{
    id: 'de_hj_pznk', name: 'гитлерюгенд-истребители танков (I–IV батальоны)', side: 'de' as const, hq: ninth.find((o) => o.hq === 'de_xi_ss')?.hq ?? ninth[0].hq,
    kind: 'kg', mobility: 'foot' as const, size: 'other' as const, quality: 0.6, personnel: 2000, tanks: 0, guns: 0, ammo: 1, fuel: 1, pos: [13.905, 52.2058] as LngLat,
    notes: ['численность и район: 2 000 у Бескова — Шторкова (Bahm, A); качество 0,6 — допущение'],
  }] : [];
  return [...res, ...hj];
}
