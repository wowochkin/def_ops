import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function collectFunctionalIds(specification) {
  return [...new Set(specification.match(/KSHVI-F-[A-Z]+-\d{2}/g) ?? [])];
}

export function evaluateFunctionalMatrix(specification, matrix) {
  const required = collectFunctionalIds(specification);
  const requiredSet = new Set(required);
  const entries = Array.isArray(matrix.requirements) ? matrix.requirements : [];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const unimplemented = required.filter(id => !Array.isArray(byId.get(id)?.implementation) || byId.get(id).implementation.length === 0);
  const missingTests = required.filter(id => !Array.isArray(byId.get(id)?.tests) || byId.get(id).tests.length === 0);
  const missingEvidence = required.filter(id => !Array.isArray(byId.get(id)?.evidence) || byId.get(id).evidence.length === 0);
  const unexpectedIds = entries.map(entry => entry.id).filter(id => !requiredSet.has(id));
  return {
    unimplemented,
    missingTests,
    missingEvidence,
    unexpectedIds,
    totalMismatch: matrix.total === required.length ? null : { expected: required.length, actual: matrix.total },
  };
}

function parseArgs(argv) {
  const options = { spec: 'docs/superpowers/specs/2026-11-20-kshvi-modern-design.md', output: 'docs/release/kshvi/functional-contract-matrix.json', requireTotal: 267, requireComplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--spec') options.spec = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--require-total') options.requireTotal = Number(argv[++index]);
    else if (arg === '--require-complete') options.requireComplete = true;
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const specification = readFileSync(options.spec, 'utf8');
  const required = collectFunctionalIds(specification);
  if (required.length !== options.requireTotal) throw new Error(`Ожидалось ${options.requireTotal} функциональных требований, найдено ${required.length}`);
  const output = resolve(options.output);
  const previous = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : { total: required.length, requirements: [] };
  const previousEntries = new Map((previous.requirements ?? []).map(entry => [entry.id, entry]));
  const matrix = {
    total: required.length,
    requirements: required.map(id => ({
      id,
      implementation: previousEntries.get(id)?.implementation ?? [],
      tests: previousEntries.get(id)?.tests ?? [],
      evidence: previousEntries.get(id)?.evidence ?? [],
    })),
  };
  const gaps = evaluateFunctionalMatrix(specification, matrix);
  writeFileSync(output, `${JSON.stringify({ ...matrix, ...gaps }, null, 2)}\n`);
  const failed = gaps.unimplemented.length || gaps.missingTests.length || gaps.missingEvidence.length || gaps.unexpectedIds.length || gaps.totalMismatch;
  console.log(JSON.stringify({ total: matrix.total, gaps, requireComplete: options.requireComplete }, null, 2));
  return options.requireComplete && failed ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
