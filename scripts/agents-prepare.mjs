// Готовые прогоны агентной модели для «Отчёта» и браузерного режима: пересчитываются сами перед запуском приложения,
// если их нет или они старше сценариев, правил или ядра. Вручную запускать ничего не нужно.
//   node scripts/agents-prepare.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const newest = (p) => {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  if (!s.isDirectory()) return s.mtimeMs;
  return Math.max(0, ...readdirSync(p).map((f) => newest(join(p, f))));
};
const inputs = Math.max(newest('crates/agents-core/src'), newest('packages/sim/data/rules/agents-v0.json'), newest('packages/sim/data/scenarios/agents'));
const VARIANTS = ['doctrine', 'su-doctrine', 'both-doctrine', 'nofires', 'nowithdraw'];
const stale = (dir) => !existsSync(`${dir}/summary.json`) || !existsSync(`${dir}/trace.json`) || statSync(`${dir}/summary.json`).mtimeMs < inputs;
const todo = ['berlin', 'seelow'].filter((scen) => [`evals-out/agents/${scen}`, ...VARIANTS.map((v) => `evals-out/agents/${scen}-${v}`)].some(stale));
if (!todo.length) { console.log('прогоны агентной модели свежие'); process.exit(0); }
console.log(`пересчёт прогонов агентной модели: ${todo.join(', ')} (сценарии, правила или ядро изменились)…`);
execFileSync('cargo', ['build', '--release', '-q', '--bin', 'agents-run'], { stdio: 'inherit' });
for (const scen of todo) {
  const path = `packages/sim/data/scenarios/agents/${scen}-1945.json`;
  execFileSync('target/release/agents-run', ['--scenario', path, '--out', `evals-out/agents/${scen}`], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('node', ['scripts/agents-variants.mjs', scen], { stdio: ['ignore', 'ignore', 'inherit'] });
}
console.log('готово');
