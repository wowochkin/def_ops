import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
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

function safePath(root, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  const absoluteRoot = resolve(root);
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(absoluteRoot, candidate);
  const rel = relative(absoluteRoot, absolute);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return null;
  return absolute;
}

export function inspectProtocol(record, { root, currentCommit }) {
  const issues = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['INVALID_RECORD'];
  if (record.status !== 'passed') issues.push('STATUS');
  if (!record.commit || record.commit !== currentCommit) issues.push('STALE_COMMIT');
  if (typeof record.command !== 'string' || record.command.trim().length === 0) issues.push('COMMAND');
  if (!Array.isArray(record.openErrors) || record.openErrors.length > 0) issues.push('OPEN_ERRORS');
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
    issues.push('ARTIFACTS');
  } else {
    for (const artifact of record.artifacts) {
      const path = safePath(root, artifact);
      if (!path) issues.push(`UNSAFE_ARTIFACT:${String(artifact)}`);
      else if (!existsSync(path)) issues.push(`MISSING_ARTIFACT:${artifact}`);
    }
  }
  if (record.archive && (record.archive.autonomous !== true || !Array.isArray(record.archive.missing) || record.archive.missing.length > 0)) {
    issues.push('INCOMPLETE_ARCHIVE');
  }
  return [...new Set(issues)];
}

export function countPassed(directory, prefix, verification) {
  if (!existsSync(directory)) return 0;
  let count = 0;
  for (let number = 1; number <= 30; number += 1) {
    const id = `${prefix}-${String(number).padStart(2, '0')}`;
    const path = resolve(directory, `${id}.json`);
    if (!existsSync(path)) continue;
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (verification) {
        if (inspectProtocol(record, verification).length === 0) count += 1;
      } else if (record.status === 'passed') count += 1;
    } catch { /* повреждённый протокол не засчитывается */ }
  }
  return count;
}

export function openLimitations(records, verification) {
  if (!Array.isArray(records)) return [{ id: 'LIMITATIONS_INVALID' }];
  return records.flatMap(record => {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') return [{ id: 'LIMITATION_INVALID' }];
    if (record.status !== 'closed') return [record];
    return inspectProtocol(record.resolution, verification).length === 0 ? [] : [{ ...record, status: 'INVALID_CLOSURE' }];
  });
}

function existingPaths(root, values) {
  return Array.isArray(values) && values.length > 0 && values.every(value => {
    const candidate = typeof value === 'string' ? value : value?.path;
    const path = safePath(root, candidate);
    return path && existsSync(path);
  });
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
    else if (arg === '--spec' || arg === '--require-functional' || arg === '--require-nf' || arg === '--require-ac') argv[++index];
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  const root = process.cwd();
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const verification = { root, currentCommit };
  const matrixPath = resolve(options.functionalDir, 'functional-contract-matrix.json');
  const matrix = existsSync(matrixPath) ? JSON.parse(readFileSync(matrixPath, 'utf8')) : { requirements: [] };
  const functionalPassed = (matrix.requirements ?? []).filter(entry => existingPaths(root, entry.implementation) && existingPaths(root, entry.tests) && existingPaths(root, entry.evidence)).length;
  const nfPassed = countPassed(options.nfDir, 'NF', verification);
  const acPassed = countPassed(options.acceptanceDir, 'AC', verification);
  const ac28Path = resolve(options.acceptanceDir, 'AC-28.json');
  let expositionPassed = false;
  if (existsSync(ac28Path)) {
    try { expositionPassed = inspectProtocol(JSON.parse(readFileSync(ac28Path, 'utf8')), verification).length === 0; }
    catch { expositionPassed = false; }
  }
  const pyramidPath = resolve(options.functionalDir, 'test-pyramid.json');
  const pyramid = existsSync(pyramidPath) ? JSON.parse(readFileSync(pyramidPath, 'utf8')) : { levels: [] };
  const levels = pyramid.levels ?? [];
  const fullChecksPassed = pyramid.commit === currentCommit && ['unit', 'contract', 'integration', 'endToEnd', 'loadAndRecovery'].every(kind => levels.some(level => level.kind === kind && inspectProtocol({ ...level, commit: level.commit ?? pyramid.commit }, verification).length === 0));
  const limitationRecords = existsSync(options.limitations) ? JSON.parse(readFileSync(options.limitations, 'utf8')) : [{ id: 'LIMITATIONS_FILE_MISSING' }];
  const unresolved = openLimitations(limitationRecords, verification);
  const gaps = finalReleaseGaps({ functionalPassed, nfPassed, acPassed, expositionPassed: requireExposition ? expositionPassed : true, openLimitations: unresolved, fullChecksPassed });
  const evidence = { commit: currentCommit, functionalPassed, nfPassed, acPassed, expositionPassed, openLimitations: unresolved, fullChecksPassed, gaps };
  writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  return gaps.length ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
