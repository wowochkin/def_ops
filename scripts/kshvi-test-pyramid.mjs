import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_LEVELS = ['unit', 'contract', 'integration', 'endToEnd', 'loadAndRecovery'];

export function evaluatePyramid(pyramid) {
  const levels = Array.isArray(pyramid.levels) ? pyramid.levels : [];
  const byKind = new Map(levels.map(level => [level.kind, level]));
  const missingLevels = REQUIRED_LEVELS.filter(kind => !byKind.has(kind));
  const invalidLevels = levels.filter(level => (
    !REQUIRED_LEVELS.includes(level.kind)
    || level.status !== 'passed'
    || typeof level.command !== 'string'
    || level.command.trim().length === 0
    || !Array.isArray(level.artifacts)
    || level.artifacts.length === 0
  )).map(level => level.kind);
  const unexpectedLevels = levels.map(level => level.kind).filter(kind => !REQUIRED_LEVELS.includes(kind));
  return { missingLevels, invalidLevels, unexpectedLevels };
}

function main(argv) {
  let output = 'docs/release/kshvi/test-pyramid.json';
  let requireComplete = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') output = argv[++index];
    else if (arg === '--require-complete') requireComplete = true;
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  const path = resolve(output);
  const pyramid = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { levels: REQUIRED_LEVELS.map(kind => ({ kind, status: 'pending', command: '', artifacts: [] })) };
  const result = evaluatePyramid(pyramid);
  writeFileSync(path, `${JSON.stringify({ ...pyramid, ...result }, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return requireComplete && (result.missingLevels.length || result.invalidLevels.length || result.unexpectedLevels.length) ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
