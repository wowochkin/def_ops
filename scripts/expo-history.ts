/**
 * История операции для стенда: `npm run expo:history` → apps/editor/src/expo/bank-data/berlin-1945.armies.json.
 * Из истории сценария — положения армий по суткам и события с точкой, из театра — центры главных пунктов. По ним —
 * стрелки карточек, кадры камеры и сводка хода «где фронт был по истории»; сама карта — карта полного режима.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANK } from '../apps/editor/src/expo/bank';
import { shortArmy, type ExpoMapData } from '../apps/editor/src/expo/map';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
type LL = [number, number];
const theatre = read('packages/sim/data/theatres/oder-berlin-1945.json') as {
  areas: { id: string; name: string; ring: LL[] }[];
};
const scenario = read(BANK.scenario) as { hqs: { id: string; name: string; side: string; echelon: string; parent: string | null }[] };
const history = read(BANK.history) as {
  armies: { formation: string; time: string; at: LL }[];
  events: { id: string; title: string; date: string; side?: string; at?: LL }[];
};

const BBOX: [number, number, number, number] = [11.8, 51.1, 15.4, 53.1];
const r3 = (p: LL): LL => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
const CITIES: [string, string][] = [
  ['berlin', 'Берлин'], ['Frankfurt', 'Франкфурт'], ['Seelow', 'Зелов'], ['Cottbus', 'Котбус'], ['Spremberg', 'Шпремберг'],
  ['Torgau', 'Торгау'], ['Potsdam', 'Потсдам'], ['Halbe', 'Хальбе'], ['Dresden', 'Дрезден'], ['Forst', 'Форст'],
  ['Eberswalde', 'Эберсвальде'], ['Zossen', 'Цоссен'], ['Guben', 'Губен'],
];

const fronts = new Set(['su_1bf', 'su_1uf']);
const armies = scenario.hqs.filter((h) => h.echelon === 'army' && (fronts.has(h.parent ?? '') || h.side === 'de'));
const days = [...new Set(history.armies.map((a) => a.time))].sort();

const data: ExpoMapData = {
  bbox: BBOX,
  cities: CITIES.flatMap(([id, name]) => {
    const a = theatre.areas.find((x) => x.id === id);
    if (!a) return [];
    const c = a.ring.reduce((s, p) => [s[0] + p[0] / a.ring.length, s[1] + p[1] / a.ring.length], [0, 0]) as LL;
    return [{ name, at: r3(c), capital: id === 'berlin' }];
  }),
  days,
  armies: armies
    .map((h) => ({
      id: h.id,
      label: shortArmy(h.name),
      side: h.side as 'su' | 'de',
      front: fronts.has(h.parent ?? '') ? (h.parent as 'su_1bf' | 'su_1uf') : null,
      track: days.map((d) => {
        const p = history.armies.find((a) => a.formation === h.id && a.time === d);
        return p ? r3(p.at) : null;
      }),
    }))
    .filter((a) => a.track.some(Boolean)),
  events: history.events.filter((e) => e.at).map((e) => ({ id: e.id, title: e.title, date: e.date, at: r3(e.at!) })),
};
writeFileSync(join(ROOT, 'apps/editor/src/expo/bank-data/berlin-1945.armies.json'), JSON.stringify(data) + '\n');
console.log(`пунктов ${data.cities.length}, армий ${data.armies.length}, суток ${days.length}, событий ${data.events.length}`);
