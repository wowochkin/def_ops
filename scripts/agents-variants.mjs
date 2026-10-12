// Варианты агентной модели для сравнения в приложении (браузерный режим): немецкие штабы по доктрине, без
// артподготовки, без отвода с первой позиции. В приложении (Tauri) варианты считаются сами.
//   node scripts/agents-variants.mjs berlin|seelow
import { execFileSync } from 'node:child_process';

const scen = process.argv[2] ?? 'berlin';
const path = `packages/sim/data/scenarios/agents/${scen}-1945.json`;
const variants = { doctrine: ['--de', 'doctrine'], nofires: ['--without-fires'], nowithdraw: ['--without-withdrawals'] };
execFileSync('cargo', ['build', '--release', '-q', '--bin', 'agents-run'], { stdio: 'inherit' });
for (const [id, flags] of Object.entries(variants)) {
  const out = `evals-out/agents/${scen}-${id}`;
  execFileSync('target/release/agents-run', ['--scenario', path, '--out', out, '--runs', '1', ...flags], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`${id}: ${out}/trace.json`);
}
