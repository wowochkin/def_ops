// Подготовка настольного приложения (apps/desktop):
//   node scripts/desktop-bundle.mjs --node-only — только Node рядом с приложением (нужно и для tauri dev);
//   node scripts/desktop-bundle.mjs             — ещё собранный редактор, сервисы одним файлом каждый и sharp.
// Node — тот, которым запущен скрипт (своя версия и архитектура машины сборки).
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps/desktop');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });

// Node рядом с приложением: binaries/node-<целевая платформа> (так Tauri ищет externalBin)
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1];
const ext = process.platform === 'win32' ? '.exe' : '';
const bin = join(app, 'src-tauri/binaries', `node-${triple}${ext}`);
mkdirSync(dirname(bin), { recursive: true });
if (!existsSync(bin)) { copyFileSync(process.execPath, bin); chmodSync(bin, 0o755); }
console.log(`Node ${process.version} → ${bin}`);
if (process.argv.includes('--node-only')) process.exit(0);

// редактор
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);

// сервисы — по одному файлу; sharp (картография) — нативный, рядом в node_modules
const dist = join(app, 'server/dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const esbuild = join(root, 'node_modules/.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
for (const s of ['documents', 'render', 'registry', 'cartography', 'gateway']) {
  run(esbuild, [`services/${s}/src/main.ts`, '--bundle', '--platform=node', '--format=esm', '--target=node22',
    `--outfile=${join(dist, `${s}.mjs`)}`, '--external:sharp', '--external:pg-native',
    '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);']);
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
console.log(`сервисы: ${dist}; зависимости: ${[...copied].join(', ')}`);
