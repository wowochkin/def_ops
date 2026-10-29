/**
 * Опыт «потолок по маршрутам»: режим «фронты по истории» с испорченными распоряжениями фронтов армиям. Каждый вариант
 * пишет копию сценария Берлинской с изменёнными `frontDirectives` (сдвиг срока, сдвиг места, прореживание, только
 * распоряжения танковым армиям) и меряет её калибровщиком (`calibrate.ts --measure --scenario-file`). Порча одна на
 * вариант (свой генератор), прогоны — по seed. Распоряжения до начала операции (form = order) не трогаются.
 *
 *   npx tsx packages/sim/tools/agents/front-noise.ts --seeds 1-20 --jobs 4 --out evals-out/exp/front-noise
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const out = resolve(ROOT, opt('out', 'evals-out/exp/front-noise')!);
mkdirSync(out, { recursive: true });

type LngLat = [number, number];
interface Dir { id: string; at: string; from: string; to: string[]; form: string; immediate?: { line?: LngLat[] } | null; [k: string]: unknown }
const SRC = 'packages/sim/data/scenarios/agents/berlin-1945.json';
const base = JSON.parse(readFileSync(resolve(ROOT, SRC), 'utf8')) as { frontDirectives: Dir[] };
const TANK = new Set(['su_1gta', 'su_2gta', 'su_3gta', 'su_4gta']);

/** Детерминированный генератор (mulberry32) и нормальное число (Бокс — Мюллер). */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const KM_LAT = 1 / 111.2, KM_LNG = 1 / (111.2 * Math.cos((52.5 * Math.PI) / 180));
const shiftHours = (at: string, h: number) => new Date(Date.parse(`${at}:00Z`) + Math.round(h) * 3_600_000).toISOString().slice(0, 16);

/** Варианты: имя → преобразование распоряжений в ходе операции (form = instruction). */
const VARIANTS: Record<string, (ds: Dir[], r: () => number) => Dir[]> = {
  base: (ds) => ds,
  'time-12h': (ds, r) => ds.map((d) => ({ ...d, at: shiftHours(d.at, 12 * gauss(r)) })),
  'time-24h': (ds, r) => ds.map((d) => ({ ...d, at: shiftHours(d.at, 24 * gauss(r)) })),
  'time-48h': (ds, r) => ds.map((d) => ({ ...d, at: shiftHours(d.at, 48 * gauss(r)) })),
  'late-24h': (ds) => ds.map((d) => ({ ...d, at: shiftHours(d.at, 24) })),
  'place-5km': (ds, r) => ds.map((d) => move(d, 5, r)),
  'place-10km': (ds, r) => ds.map((d) => move(d, 10, r)),
  'place-20km': (ds, r) => ds.map((d) => move(d, 20, r)),
  'time-24h+place-10km': (ds, r) => ds.map((d) => move({ ...d, at: shiftHours(d.at, 24 * gauss(r)) }, 10, r)),
  'every-2nd': (ds) => thin(ds, 2),
  'every-4th': (ds) => thin(ds, 4),
  'tank-only': (ds) => ds.filter((d) => d.to.some((t) => TANK.has(t))),
  'no-tank': (ds) => ds.filter((d) => !d.to.some((t) => TANK.has(t))),
  none: () => [],
};

/** Сдвиг места: весь рубеж или пункт распоряжения — на один случайный вектор (σ км по каждой оси / √2). */
function move(d: Dir, km: number, r: () => number): Dir {
  const line = d.immediate?.line;
  if (!line?.length) return d;
  const dx = (gauss(r) * km) / Math.SQRT2, dy = (gauss(r) * km) / Math.SQRT2;
  return { ...d, immediate: { ...d.immediate, line: line.map(([x, y]) => [x + dx * KM_LNG, y + dy * KM_LAT] as LngLat) } };
}
/** Прореживание: у каждой армии остаётся каждое k-е распоряжение по порядку срока. */
function thin(ds: Dir[], k: number): Dir[] {
  const n = new Map<string, number>();
  return [...ds].sort((a, b) => a.at.localeCompare(b.at)).filter((d) => { const key = d.to.join(','); const i = n.get(key) ?? 0; n.set(key, i + 1); return i % k === 0; });
}

const only = opt('only')?.split(',');
for (const [k, [name, f]] of Object.entries(VARIANTS).entries()) {
  if (only && !only.includes(name)) continue;
  const r = rng(1000 + k);
  // в ходе операции — боевые распоряжения фронтов; распоряжения на начало и задачи по журналам (режим journals) не трогаются
  const live = (d: Dir) => d.form === 'instruction' && !d.id.endsWith(':journal');
  const fd = [...base.frontDirectives.filter((d) => !live(d)), ...f(base.frontDirectives.filter(live), r)];
  const file = `${out}/${name}.json`;
  writeFileSync(file, JSON.stringify({ ...base, frontDirectives: fd }));
  copyFileSync(resolve(ROOT, SRC.replace(/\.json$/, '.history.json')), file.replace(/\.json$/, '.history.json'));
  const p = spawnSync('npx', ['tsx', 'packages/sim/tools/agents/calibrate.ts', '--measure', '--mode', 'fronts', '--scenario', 'berlin', '--scenario-file', file,
    '--seeds', opt('seeds', '1-20')!, '--jobs', opt('jobs', '4')!, '--out', `${out}/m-${name}`], { cwd: ROOT, encoding: 'utf8' });
  const line = p.stdout.trim().split('\n').pop() ?? '';
  writeFileSync(`${out}/${name}.result.json`, line + '\n');
  console.log(`${name}: распоряжений ${fd.length} — ${line}`);
}
