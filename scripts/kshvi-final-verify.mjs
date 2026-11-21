import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function finalReleaseGaps({ functionalPassed, nfPassed, acPassed, expositionPassed, openLimitations, fullChecksPassed }) {
  const gaps = [];
  if (functionalPassed !== 267) gaps.push(`FUNCTIONAL_COUNT:${functionalPassed}`);
  if (nfPassed !== 22) gaps.push(`NF_COUNT:${nfPassed}`);
  if (acPassed !== 30) gaps.push(`AC_COUNT:${acPassed}`);
  if (!expositionPassed) gaps.push('EXPOSITION_NOT_PASSED');
  for (const limitation of openLimitations) gaps.push(`OPEN_LIMITATION:${limitation.id}`);
  if (!fullChecksPassed) gaps.push('FULL_CHECKS_FAILED');
  return gaps;
}

function passedCount(directory, prefix) {
  if (!existsSync(directory)) return 0;
  const records = [];
  for (let number = 1; number <= 30; number += 1) {
    const id = `${prefix}-${String(number).padStart(2, '0')}`;
    const path = resolve(directory, `${id}.json`);
    if (!existsSync(path)) continue;
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (record.status === 'passed') records.push(id);
  }
  return records;
}

function main(argv) {
  const options = { functionalDir: 'docs/release/kshvi', acceptanceDir: 'docs/release/kshvi/acceptance', nfDir: 'docs/release/kshvi/nonfunctional', limitations: 'docs/release/kshvi/limitations.json', output: 'docs/release/kshvi/final-evidence-index.json' };
  let requireExposition = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--functional-dir') options.functionalDir = argv[++index];
    else if (arg === '--acceptance-dir') options.acceptanceDir = argv[++index];
    else if (arg === '--nf-dir') options.nfDir = argv[++index];
    else if (arg === '--limitations') options.limitations = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--require-exposition') requireExposition = true;
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  const matrixPath = resolve(options.functionalDir, 'functional-contract-matrix.json');
  const matrix = existsSync(matrixPath) ? JSON.parse(readFileSync(matrixPath, 'utf8')) : { requirements: [] };
  const functionalPassed = (matrix.requirements ?? []).filter(entry => entry.implementation?.length && entry.tests?.length && entry.evidence?.length).length;
  const nfPassed = passedCount(options.nfDir, 'NF').length;
  const acPassed = passedCount(options.acceptanceDir, 'AC').length;
  const ac28Path = resolve(options.acceptanceDir, 'AC-28.json');
  const expositionPassed = existsSync(ac28Path) && JSON.parse(readFileSync(ac28Path, 'utf8')).status === 'passed';
  const pyramidPath = resolve(options.functionalDir, 'test-pyramid.json');
  const pyramid = existsSync(pyramidPath) ? JSON.parse(readFileSync(pyramidPath, 'utf8')) : { levels: [] };
  const levels = pyramid.levels ?? [];
  const fullChecksPassed = ['unit', 'contract', 'integration', 'endToEnd', 'loadAndRecovery'].every(kind => levels.some(level => level.kind === kind && level.status === 'passed' && level.command && level.artifacts?.length));
  const openLimitations = existsSync(options.limitations) ? JSON.parse(readFileSync(options.limitations, 'utf8')) : [{ id: 'LIMITATIONS_FILE_MISSING' }];
  const gaps = finalReleaseGaps({ functionalPassed, nfPassed, acPassed, expositionPassed: requireExposition ? expositionPassed : true, openLimitations, fullChecksPassed });
  const evidence = { functionalPassed, nfPassed, acPassed, expositionPassed, openLimitations, fullChecksPassed, gaps };
  writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  return gaps.length ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
