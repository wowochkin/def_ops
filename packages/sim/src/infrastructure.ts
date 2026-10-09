/**
 * Состояние инфраструктуры операции: сведения о мостах, переправах, дорогах и железных дорогах (из документов —
 * с цитатой, или добавленные человеком). Сведение привязывается к театру (мост, точка, радиус) и ложится поверх
 * театра при расчёте: мост разрушен с даты, переправа наведена, дорога перекрыта. То, что в расчёт не входит
 * (повреждён, но проходим; рубеж без привязки), остаётся сведением — видно в операции и в базе знаний.
 */
import type { LngLat } from '@def-ops/core';
import { dist } from './geo';
import { areaOriginal, areaTitle } from './reports';
import type { Theatre } from './theatre';
import type { TheatreData } from './types';

export type InfraKind = 'bridge' | 'crossing' | 'road' | 'rail' | 'line' | 'other';
export type InfraState = 'destroyed' | 'damaged' | 'intact' | 'built' | 'repaired' | 'blocked' | 'mined' | 'impassable' | 'fortified';

export const INFRA_KIND_RU: Record<InfraKind, string> = { bridge: 'мост', crossing: 'переправа', road: 'дорога', rail: 'железная дорога', line: 'рубеж', other: 'прочее' };
export const INFRA_STATE_RU: Record<InfraState, string> = {
  destroyed: 'разрушен', damaged: 'повреждён', intact: 'цел', built: 'наведён/построен', repaired: 'восстановлен',
  blocked: 'перекрыт', mined: 'заминирован', impassable: 'непроходим', fortified: 'укреплён',
};

export interface InfraRecord {
  id: string;
  kind: InfraKind;
  state: InfraState;
  /** Что это словами: «мост через Шпрее у Фюрстенвальде». */
  title: string;
  /** Пункт, у которого объект (как в тексте, в именительном падеже). */
  place?: string;
  river?: string;
  /** С какого момента (ГГГГ-ММ-ДД или ГГГГ-ММ-ДДTчч:мм); нет — с начала операции. */
  from?: string | null;
  until?: string | null;
  /** Чьими силами (разрушен, наведён): id стороны. */
  side?: string | null;
  /** Привязка к театру: мост театра, точка, радиус (для дорог). */
  bridge?: string;
  at?: LngLat;
  radiusKm?: number;
  note?: string;
  source?: { doc?: string; docName?: string; quote?: string; reliability?: string };
  origin: 'document' | 'user';
  added?: string;
}

/* ───────────── поиск пункта и объекта на театре ───────────── */

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»"“”„'’`()]/g, ' ').replace(/[\s\-–—_]+/g, ' ').trim();
/** Основа слова: падежные окончания не мешают («у Кюстрина» — «Кюстрин»). */
const stem = (w: string) => (w.length > 5 ? w.slice(0, Math.max(5, w.length - 2)) : w);
const sameName = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' '), ys = y.split(' ');
  return xs.length === ys.length && xs.every((w, i) => w === ys[i] || (w.length >= 4 && ys[i].length >= 4 && (w.startsWith(stem(ys[i])) || ys[i].startsWith(stem(w)))));
};
/** Немецкое название — как его пишут по-русски (приблизительно): Fuerstenwalde → фюрстенвальде, Seelow → зелов. */
export function deToRu(name: string): string {
  let x = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  x = x.replace(/\bst/g, 'шт').replace(/\bsp/g, 'шп');
  const R: [RegExp, string][] = [[/tsch/g, 'ч'], [/sch/g, 'ш'], [/ch/g, 'х'], [/ck/g, 'к'], [/ei/g, 'ай'], [/(eu|aeu)/g, 'ой'], [/ie/g, 'и'], [/ue/g, 'ю'], [/oe/g, 'ё'], [/ae/g, 'е'], [/ee/g, 'е'], [/tz/g, 'ц'], [/qu/g, 'кв'], [/ph/g, 'ф'], [/th/g, 'т'],
    [/([aeiou])h/g, '$1'], [/s(?=[aeiouy])/g, 'з'], [/l(?=[^aeiouy]|$)/g, 'ль']];
  for (const [re, v] of R) x = x.replace(re, v);
  const M: Record<string, string> = { a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', v: 'ф', w: 'в', x: 'кс', y: 'и', z: 'ц' };
  return x.replace(/[a-z]/g, (c) => M[c] ?? c).replace(/(.)\1+/g, '$1');
}

/** Варианты названия: «Кюстрин (Küstrin)» → «Кюстрин», «Küstrin». */
const variants = (x: string) => [x, ...x.split(/[()]/).map((p) => p.trim()).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);

/** Реки по-русски → как в театре. */
const RIVERS: Record<string, string> = {
  одер: 'Oder', одра: 'Oder', нейсе: 'Neiße', шпрее: 'Spree', хафель: 'Havel', гафель: 'Havel', эльба: 'Elbe', висла: 'Wisła', варта: 'Warthe', нетце: 'Netze',
  пилица: 'Pilica', бзура: 'Bzura', нарев: 'Narew', буг: 'Bug', сан: 'San', ниса: 'Neiße', даме: 'Dahme', финов: 'Finowkanal', тельтов: 'Teltowkanal', ландвер: 'Landwehrkanal',
};
function riverNames(river?: string): string[] {
  if (!river) return [];
  const out = variants(river);
  for (const v of [...out]) { const k = Object.keys(RIVERS).find((r) => norm(v).startsWith(r)); if (k) out.push(RIVERS[k]); }
  return out;
}

/** Пункт театра по названию (по-русски или в оригинале, с точностью до падежа). */
export function locatePlace(T: Theatre, name?: string): { id: string; title: string; at: LngLat; radiusKm: number } | null {
  if (!name?.trim()) return null;
  const want = variants(name);
  for (const a of T.data.areas) {
    const names = [a.name, areaOriginal(a.name), deToRu(areaOriginal(a.name).split(/[ ,]/)[0]), ...variants(areaTitle(a.name))];
    if (!names.some((n) => want.some((w) => sameName(n, w)))) continue;
    const ar = T.area(a.id);
    if (!ar) continue;
    const c = T.proj.toXY(ar.center);
    const r = Math.max(...ar.ring.map((p) => dist(T.proj.toXY(p), c)));
    return { id: a.id, title: areaTitle(a.name), at: ar.center, radiusKm: Math.min(3, Math.max(0.5, r * 0.6)) };
  }
  return null;
}

export interface InfraResolution { bridge?: string; at?: LngLat; radiusKm?: number; how: string }

/**
 * Привязать сведение к театру: мост — ближайший мост театра у пункта (на той же реке, если она названа);
 * наведённая переправа — точка на ближайшей реке у пункта; дорога — круг у пункта. null — не нашли.
 */
export function resolveInfra(T: Theatre, r: Pick<InfraRecord, 'kind' | 'state' | 'place' | 'river' | 'title'>): InfraResolution | null {
  const p = locatePlace(T, r.place);
  const rivers = riverNames(r.river);
  if (r.kind === 'bridge' || r.kind === 'crossing') {
    // мост по названию («мост Мольтке») — среди мостов театра
    const named = T.data.bridges.find((b) => b.name && variants(r.title).some((t) => norm(t).length > 6 && norm(b.name!).includes(norm(t))));
    if (named) return { bridge: named.id, at: named.at, how: `мост театра «${named.name}»` };
    if (!p) return null;
    const c = T.proj.toXY(p.at);
    const near = T.data.bridges
      .map((b) => ({ b, d: dist(T.proj.toXY(b.at), c) }))
      .filter((x) => x.d <= Math.max(5, p.radiusKm * 2) && (!rivers.length || !(x.b as { river?: string }).river || rivers.some((n) => sameName(n, (x.b as { river?: string }).river!))))
      .sort((a, b) => a.d - b.d)[0];
    const fresh = r.state === 'built' || (r.kind === 'crossing' && r.state !== 'destroyed');
    if (near && !fresh) return { bridge: near.b.id, at: near.b.at, how: `мост театра «${near.b.name ?? near.b.id}», ${near.d.toFixed(1)} км от пункта ${p.title}` };
    if (fresh || r.state === 'repaired') {
      const rv = T.nearestRiver(p.at, Math.max(6, p.radiusKm * 2));
      if (rv) return { at: rv.at, how: `точка на реке у пункта ${p.title}` };
    }
    if (near) return { bridge: near.b.id, at: near.b.at, how: `мост театра «${near.b.name ?? near.b.id}» у пункта ${p.title}` };
    // пункт есть, а моста театра рядом нет — разрушать нечего (сведение остаётся)
    return { at: p.at, how: `у пункта ${p.title} мостов театра${rivers.length ? ` через ${r.river}` : ''} нет` };
  }
  if (r.kind === 'road' || r.kind === 'rail') return p ? { at: p.at, radiusKm: p.radiusKm, how: `у пункта ${p.title}, радиус ${p.radiusKm.toFixed(1)} км` } : null;
  return p ? { at: p.at, how: `пункт ${p.title}` } : null;
}

/* ───────────── действие на расчёт ───────────── */

const t = (d?: string | null) => (d ? (d.length === 10 ? `${d}T00:00` : d.slice(0, 16)) : null);
const ru = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');

/** Что сведение меняет в расчёте (словами); null — в расчёт не входит. */
export function infraEffect(r: InfraRecord): string | null {
  const from = r.from ? ` с ${ru(r.from)}` : ' с начала операции', until = r.until ? ` до ${ru(r.until)}` : '';
  if (r.kind === 'bridge' || r.kind === 'crossing') {
    if (r.state === 'destroyed' && r.bridge) return `мост не действует${from}${until}`;
    if ((r.state === 'built' || r.state === 'repaired' || (r.kind === 'crossing' && r.state === 'intact')) && (r.at || r.bridge)) return `${r.kind === 'crossing' ? 'переправа' : 'мост'} действует${from}${until}`;
    if (r.state === 'intact' && r.bridge) return `мост цел${from}${until} — разрушение в театре снимается`;
    return null;
  }
  if (r.kind === 'road' && ['destroyed', 'blocked', 'mined', 'impassable'].includes(r.state) && r.at) return `дорога в радиусе ${(r.radiusKm ?? 1.5).toFixed(1)} км не даёт дорожного темпа${from}${until}`;
  return null;
}

/** Театр с учётом сведений об инфраструктуре (исходный не меняется). */
export function applyInfrastructure(T: TheatreData, records: InfraRecord[] | undefined): TheatreData {
  if (!records?.length) return T;
  const bridges = T.bridges.map((b) => ({ ...b }));
  const obstacles = [...(T.obstacles ?? [])];
  for (const r of records) {
    if (!infraEffect(r)) {
      if (r.kind === 'rail' && r.at && ['destroyed', 'blocked', 'mined', 'impassable'].includes(r.state)) obstacles.push({ id: `infra-${r.id}`, at: r.at, radiusKm: r.radiusKm ?? 1.5, kind: 'rail', from: t(r.from), until: t(r.until), note: r.title });
      continue;
    }
    const b = r.bridge ? bridges.find((x) => x.id === r.bridge) : undefined;
    if (r.kind === 'road') { obstacles.push({ id: `infra-${r.id}`, at: r.at!, radiusKm: r.radiusKm ?? 1.5, kind: 'road', from: t(r.from), until: t(r.until), note: r.title }); continue; }
    if (r.state === 'destroyed' && b) {
      const at = t(r.from) ?? '0000-01-01T00:00';
      if (!b.destroyedAt || at < b.destroyedAt) b.destroyedAt = at;
    } else if (r.state === 'intact' && b && r.kind === 'bridge') {
      b.destroyedAt = t(r.until);
    } else {
      const at = r.at ?? b?.at;
      if (at) bridges.push({ id: `infra-${r.id}`, at, name: r.title, openFrom: t(r.from), destroyedAt: t(r.until), ...(r.side ? { side: r.side } : {}), kind: r.kind === 'crossing' ? 'ferry' : 'bridge' });
    }
  }
  return { ...T, bridges, obstacles, sources: [...(T.sources ?? []), `Сведения об инфраструктуре операции: ${records.length}`] };
}
