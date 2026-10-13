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

/**
 * Части вне дивизий 4 ТА. Перед всем 1 УФ (410 км) на 15.04 — 78 отдельных батальонов (47 фольксштурма), 17 разных
 * полков, 4 бригады штурмовых орудий и 3 истребительно-противотанковые, 6 артполков, 9 артдивизионов, 7 ПТ и 7 зенитных
 * дивизионов (советская справка, РА-15, док. 13, B). В театр попадает полоса 4 ТА от Губена до Гёрлица — около 90 км,
 * доля 0,22 (C). Численность (C, допущения): батальон 400 (фольксштурм — 300–700 в батальоне), полк 1 200, бригада
 * 600, артполк 1 000, дивизион 300 — всего ≈ 69 тыс., в театре ≈ 15 тыс.; орудия — полк 36, дивизион 12 (≈ 490,
 * в театре ≈ 110); бронетехника — по 20 исправных машин в бригаде (≈ 140, в театре ≈ 30). Раскладка по корпусам —
 * пропорционально их дивизиям, положение — вторая позиция в 8 км за ними, как у 9 А.
 */
const FOURTH_PZA_SHARE = 90 / 410;
const FOURTH_PZA = { personnel: (78 * 400 + 17 * 1200 + 7 * 600 + 6 * 1000 + 23 * 300) * FOURTH_PZA_SHARE, guns: (6 * 36 + 23 * 12) * FOURTH_PZA_SHARE, tanks: 7 * 20 * FOURTH_PZA_SHARE };
export function reinforcements4pza(out: Agent[], groups: Map<string, string[]>, hqName: (id: string) => string): Agent[] {
  const all = [...groups.values()].flat();
  const units = out.filter((o) => o.side === 'de' && all.includes(o.hq));
  const total = units.reduce((s, o) => s + o.personnel, 0) || 1;
  const res: Agent[] = [];
  for (const [hq, members] of groups) {
    const cd = units.filter((o) => members.includes(o.hq));
    if (!cd.length) continue;
    const share = cd.reduce((s, o) => s + o.personnel, 0) / total;
    const c = cd.reduce<LngLat>((s, o) => [s[0] + o.pos[0] / cd.length, s[1] + o.pos[1] / cd.length], [0, 0]);
    // тыл 4 ТА — на запад (фронт по Нейсе на восток)
    const pos: LngLat = [+(c[0] - 8 / KX).toFixed(4), +c[1].toFixed(4)];
    res.push({
      id: `${hq}_reinf`, name: `части усиления ${hqName(hq)} (вне дивизий)`, side: 'de', hq, kind: 'reinf',
      mobility: 'foot', size: 'other', quality: 0.7,
      personnel: Math.round(FOURTH_PZA.personnel * share), tanks: Math.round(FOURTH_PZA.tanks * share), guns: Math.round(FOURTH_PZA.guns * share), ammo: 1, fuel: 1, pos,
      notes: [
        'положение: вторая позиция в 8 км западнее дивизий корпуса (как у 9 А; допущение)',
        'численность, орудия, бронетехника: части вне дивизий перед 1 УФ на 15.04 (РА-15, док. 13, B) × доля полосы 4 ТА в театре 0,22, батальон 400, полк 1 200 (C)',
        'качество 0,7 — допущение (фольксштурм и сборные части)',
      ],
    });
  }
  return res;
}

/** Приказ частям усиления и гитлерюгенду — оборонять вторую позицию с начала операции. */
export function reinforcementOrders(agents: Agent[]): { at: number; hq: string; to: string[]; kind: string; target: LngLat; note: string }[] {
  return agents.filter((a) => a.kind === 'reinf' || a.id === 'de_hj_pznk')
    .map((a) => ({ at: 0, hq: a.hq, to: [a.id], kind: 'defend', target: a.pos, note: 'вторая позиция (части вне дивизий, berlin-1945-german-forces.json)' }));
}

/**
 * Немецкие части в тылу (docs/sources/berlin-1945-german-rear.json): учебные и запасные части, гарнизоны городов,
 * фольксштурм, боевые группы — от Цоссена и Котбуса до групп III тк СС у Ораниенбурга и батальонов у Эльбы. Берутся
 * записи с местом и датой 16–24.04; маркеры пробелов, записи вне окна и уже стоящие в сценарии не берутся. Где
 * численности в источнике нет — допущение по типу (C): батальон 400, полк 1 200, бригада 1 500, гарнизон города 500,
 * боевая группа 600. Подчинение — по источнику (III тк СС), иначе штаб, чьи соединения ближе всего; приказ — держаться (боевые коменданты городов).
 * Группы, собранные 21–24.04 (III тк СС, бригада Мюллера, маршевые батальоны флота), вводятся с даты записи.
 */
const REAR: Record<string, { size: number; tanks?: number; enter?: boolean }> = {
  rear_wuensdorf_pz_ausb_rgt: { size: 1200 }, rear_baruth_garrison: { size: 0 }, rear_stug_brig_218: { size: 600, tanks: 10 },
  rear_kummersdorf_range: { size: 400 }, rear_juterbog_altes_lager: { size: 400 }, rear_treuenbrietzen_volkssturm: { size: 400 },
  rear_luckenwalde: { size: 500 }, rear_cottbus_garrison: { size: 1500 }, rear_spremberg_volkssturm: { size: 0 },
  rear_brigade_mueller: { size: 1500, enter: true }, rear_brandenburg_havel_garrison: { size: 500 }, rear_finow_canal_security: { size: 400 },
  rear_kg_harzer: { size: 600, enter: true }, rear_kg_herber: { size: 0, enter: true }, rear_kg_marine_9rgt: { size: 1200, enter: true },
  rear_kg_schirmer: { size: 0, enter: true }, rear_kg_kresin: { size: 0, enter: true }, rear_kg_von_wolff: { size: 600, enter: true },
  rear_marine_march_btls_preiss: { size: 0, enter: true }, rear_7ss_pol_rgt: { size: 0 }, rear_eberswalde_festung: { size: 500 },
  rear_kg_torgau: { size: 400 }, rear_kg_riesa: { size: 400 }, rear_btl_schildau: { size: 400 }, rear_pi_btl_oschatz: { size: 400 },
  rear_zeithain_battalions: { size: 400 }, rear_prettin_annaburg: { size: 400 }, rear_kg_hermann: { size: 600 }, rear_kg_scherer: { size: 600 },
};
interface RearUnit { id: string; name: string; kind: string; subordination?: string; lng: number | null; lat: number | null; date: string | null; personnel: number | null; guns: number | null; tanks: number | null; source: string; reliability: string; area: string }
export function rearUnits(out: Agent[], units: RearUnit[]): { agents: (Agent & { enterAt?: string })[]; orders: { at: number | string; hq: string; to: string[]; kind: string; target: LngLat; note: string }[] } {
  // центры соединений немецких штабов — для подчинения ближайшему
  const groups = new Map<string, LngLat[]>();
  for (const o of out) if (o.side === 'de') groups.set(o.hq, [...(groups.get(o.hq) ?? []), o.pos]);
  const centers = [...groups].map(([hq, ps]) => ({ hq, c: ps.reduce<LngLat>((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length], [0, 0]) }));
  const agents: (Agent & { enterAt?: string })[] = [];
  const orders: { at: number | string; hq: string; to: string[]; kind: string; target: LngLat; note: string }[] = [];
  for (const u of units) {
    const spec = REAR[u.id];
    if (!spec || u.lng === null || u.lat === null) continue;
    const pos: LngLat = [u.lng, u.lat];
    // подчинение по источнику, если в нём назван III тк СС (армейская группа Штайнера); иначе — ближайший штаб
    const sub = u.subordination ?? '';
    const hq = /III/.test(sub) && /(СС|SS|Штайнер|Steiner)/.test(sub) && out.some((o) => o.hq === 'de_iii_ss') ? 'de_iii_ss' : centers.reduce((b, x) => (Math.hypot((x.c[0] - pos[0]) * KX, (x.c[1] - pos[1]) * KY) < Math.hypot((b.c[0] - pos[0]) * KX, (b.c[1] - pos[1]) * KY) ? x : b)).hq;
    const personnel = u.personnel ?? spec.size;
    const enterAt = spec.enter && u.date && u.date > '1945-04-16' ? `${u.date}T05:00` : undefined;
    agents.push({
      id: u.id, name: u.name.length > 70 ? `${u.name.slice(0, 67)}…` : u.name, side: 'de', hq, kind: 'rear', mobility: 'foot', size: 'other', quality: 0.6,
      personnel, tanks: u.tanks ?? spec.tanks ?? 0, guns: u.guns ?? 0, ammo: 1, fuel: 1, pos, ...(enterAt ? { enterAt } : {}),
      notes: [
        `положение: ${u.area} (${u.reliability}, berlin-1945-german-rear.json)`,
        u.personnel !== null ? `численность: по источнику ${u.source} (${u.reliability})` : `численность: в источнике нет — допущение по типу ${personnel} (C)`,
        'качество 0,6 — допущение (тыловые, учебные части, фольксштурм)',
      ],
    });
    orders.push({ at: enterAt ?? 0, hq, to: [u.id], kind: 'hold', target: pos, note: 'держаться: гарнизон, заслон в тылу (berlin-1945-german-rear.json)' });
  }
  return { agents, orders };
}
