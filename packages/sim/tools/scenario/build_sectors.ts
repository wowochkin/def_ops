/**
 * Участки для фокуса: из scenarios/src/<сценарий>.sectors.json (пункты театра и запас, км) —
 * scenarios/<сценарий>.sectors.json с границами (bbox) и центром. Запуск: npx tsx packages/sim/tools/scenario/build_sectors.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, loadScenario, loadTheatre } from '../../src/data';
import { Theatre } from '../../src/theatre';

const dir = join(DATA_DIR, 'scenarios');
for (const f of readdirSync(join(dir, 'src')).filter((x) => x.endsWith('.sectors.json'))) {
  const id = f.replace('.sectors.json', '');
  const src = JSON.parse(readFileSync(join(dir, 'src', f), 'utf8')) as { sectors: { id: string; title: string; note?: string; areas: string[]; padKm: number }[] };
  const T = new Theatre(loadTheatre(loadScenario(id).theatre));
  const sectors = src.sectors.map((s) => {
    const pts = s.areas.map((a) => { const x = T.area(a); if (!x) throw new Error(`${id}/${s.id}: нет пункта ${a}`); return x.center; });
    const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const dLat = s.padKm / 111, dLng = s.padKm / (111 * Math.cos((lat * Math.PI) / 180));
    const r = (x: number) => +x.toFixed(4);
    const bbox = [r(Math.min(...pts.map((p) => p[0])) - dLng), r(Math.min(...pts.map((p) => p[1])) - dLat), r(Math.max(...pts.map((p) => p[0])) + dLng), r(Math.max(...pts.map((p) => p[1])) + dLat)];
    return { id: s.id, title: s.title, ...(s.note ? { note: s.note } : {}), bbox };
  });
  writeFileSync(join(dir, `${id}.sectors.json`), JSON.stringify({ scenario: id, note: 'ключевые участки для фокуса (собрано из src/' + f + ')', sectors }, null, 1) + '\n');
  console.log(`${id}: ${sectors.length} участков`);
}
