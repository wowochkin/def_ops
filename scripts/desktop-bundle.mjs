// Подготовка настольного приложения (apps/desktop):
//   node scripts/desktop-bundle.mjs --node-only — только Node рядом с приложением (нужно и для tauri dev);
//   node scripts/desktop-bundle.mjs             — ещё собранный редактор, сервисы одним файлом каждый и sharp.
// Node — тот, которым запущен скрипт (своя версия и архитектура машины сборки).
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareNode } from './portable-node.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps/desktop');
mkdirSync(join(app, 'portable'), { recursive: true });
const require = createRequire(import.meta.url);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

// Node рядом с приложением: binaries/node-<целевая платформа> (так Tauri ищет externalBin)
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const ext = process.platform === 'win32' ? '.exe' : '';
const bin = join(app, 'src-tauri/binaries', `node-${triple}${ext}`);
mkdirSync(dirname(bin), { recursive: true });
const portableBuild = process.env.DEFOPS_PORTABLE_BUILD === '1';
const nodeSource = portableBuild ? await prepareNode(join(root, 'release/downloads/node-runtime')) : process.execPath;
if (portableBuild || !existsSync(bin)) { copyFileSync(nodeSource, bin); chmodSync(bin, 0o755); }
console.log(`Node → ${bin}`);
if (portableBuild && !existsSync(join(app, 'portable/runtime/manifest.json'))) throw Error('Не подготовлен переносимый runtime голоса');
if (portableBuild && !existsSync(join(app, 'portable/library/manifest.json'))) throw Error('Не подготовлена переносимая библиотека');
// ресурсы из tauri.conf.json Tauri проверяет и в разработке: пока редактор не собран — пустая папка
mkdirSync(join(root, 'apps/editor/dist'), { recursive: true });
if (process.argv.includes('--node-only')) process.exit(0);

// Обычная сборка тоже копирует подготовленный runtime. Tauri не может
// перезаписать read-only веса из предыдущей сборки в производной папке target.
const cargoTarget = resolve(process.env.CARGO_TARGET_DIR || join(root, 'target'));
for (const dir of [join(cargoTarget, 'release/portable'), join(cargoTarget, triple, 'release/portable')]) {
  rmSync(dir, { recursive: true, force: true });
}

// GIS дополнения лежат отдельно от TTS и попадают в ресурсы server/gis.
const gisMarker = join(app, 'server/gis/addons/defops-gis-runtime.json');
let gisReady = false;
try { const m = JSON.parse(readFileSync(gisMarker, 'utf8')); gisReady = m.platform === process.platform && m.arch === process.arch; } catch { /* первая подготовка */ }
if (!gisReady) run(process.execPath, [join(root, 'scripts/cartography-runtime.mjs'), 'prepare']);

run(process.execPath, ['--import', 'tsx', join(root, 'scripts/cartography-assets.ts')]);

// редактор
run(process.execPath, [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build'], { cwd: join(root, 'apps/editor') });

// сервисы — по одному файлу; sharp (картография) — нативный, рядом в node_modules
const dist = join(app, 'server/dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
// поток сборки и нарезки карт OHM — отдельный файл рядом со службой (картография ищет ./ohm-worker.mjs)
const entries = [
  ...['documents', 'render', 'registry', 'cartography', 'gateway'].map((s) => [`services/${s}/src/main.ts`, `${s}.mjs`]),
  ['services/cartography/src/ohm-worker.ts', 'ohm-worker.mjs'],
  ['services/cartography/src/atlas-worker.ts', 'atlas-worker.mjs'],
  ['scripts/expo-preflight.ts', 'expo-preflight.mjs'],
];
for (const [entry, out] of entries) {
  buildSync({ entryPoints: [join(root, entry)], bundle: true, platform: 'node', format: 'esm', target: 'node22',
    outfile: join(dist, out), external: ['sharp', 'pg-native'],
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' } });
}
const nm = join(app, 'server/node_modules');
rmSync(nm, { recursive: true, force: true });
const copied = new Set();
const copyPkg = (name) => {
  if (copied.has(name)) return;
  const src = join(root, 'node_modules', name);
  if (!existsSync(src)) return; // необязательная зависимость другой платформы
  copied.add(name);
  cpSync(src, join(nm, name), { recursive: true, dereference: true });
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
  for (const d of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]) copyPkg(d);
};
copyPkg('sharp');
// Только исходники: окружение .venv и веса Mac нельзя переносить на Windows.
const voice = join(app, 'server/voice-service');
rmSync(voice, { recursive: true, force: true });
mkdirSync(voice, { recursive: true });
for (const file of readdirSync(join(root, 'services/voice'), { withFileTypes: true })) {
  if (file.isFile() && /\.(py|json|txt|ps1|sh)$/.test(file.name)) copyFileSync(join(root, 'services/voice', file.name), join(voice, file.name));
}
const gis = join(app, 'server/gis');
mkdirSync(gis, { recursive: true });
for (const name of ['convert.py', 'requirements.txt', 'install.py', 'install-windows.cmd']) copyFileSync(join(root, 'services/cartography/tools', name), join(gis, name));
console.log(`сервисы: ${dist}; зависимости: ${[...copied].join(', ')}`);
