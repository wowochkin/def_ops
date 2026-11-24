import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PLAN = 'docs/superpowers/plans/2026-11-21-kshvi-full-release.md';
const TEST_DECLARATION = /(?:^|\s)(?:it|test|integration)(?:\.(?!skip\b)\w+)?\s*\(\s*(['"`])([^'"`]+)\1/g;

export function collectFunctionalIds(specification) {
  return [...new Set(specification.match(/KSHVI-F-[A-Z]+-\d{2}/g) ?? [])];
}

function safeFile(root, reference) {
  if (typeof reference !== 'string' || !reference || isAbsolute(reference)) return null;
  const path = reference.split('#')[0];
  if (!path || path.includes('\0')) return null;
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  if (!existsSync(absolute)) return null;
  try { return statSync(absolute).isFile() ? absolute : null; } catch { return null; }
}

function validTestFile(root, reference) {
  const path = safeFile(root, reference);
  if (!path) return false;
  const source = readFileSync(path, 'utf8');
  TEST_DECLARATION.lastIndex = 0;
  return TEST_DECLARATION.test(source);
}

function validEvidence(root, reference) {
  const path = safeFile(root, reference);
  if (!path) return false;
  const check = reference.includes('#') ? reference.slice(reference.indexOf('#') + 1) : '';
  if (check) {
    const source = readFileSync(path, 'utf8');
    TEST_DECLARATION.lastIndex = 0;
    return [...source.matchAll(TEST_DECLARATION)].some(match => match[2] === check);
  }
  if (path.endsWith('.json')) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      return value.status === 'passed' && typeof value.command === 'string' && value.command.trim().length > 0;
    } catch { return false; }
  }
  return true;
}

export function evaluateFunctionalMatrix(specification, matrix, options = {}) {
  const required = collectFunctionalIds(specification);
  const requiredSet = new Set(required);
  const entries = Array.isArray(matrix.requirements) ? matrix.requirements : [];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const validateFiles = options.validateFiles === true;
  const root = options.root ?? process.cwd();
  const invalid = (references, validator) => !Array.isArray(references) || references.length === 0
    || (validateFiles && references.some(reference => !validator(root, reference)));
  const unimplemented = required.filter(id => invalid(byId.get(id)?.implementation, (rootPath, reference) => Boolean(safeFile(rootPath, reference)) && !reference.includes('#')));
  const missingTests = required.filter(id => invalid(byId.get(id)?.tests, validTestFile));
  const missingEvidence = required.filter(id => invalid(byId.get(id)?.evidence, validEvidence));
  const unexpectedIds = entries.map(entry => entry.id).filter(id => !requiredSet.has(id));
  const duplicateIds = [...new Set(entries.map(entry => entry.id).filter((id, index, ids) => ids.indexOf(id) !== index))];
  return {
    unimplemented,
    missingTests,
    missingEvidence,
    unexpectedIds,
    duplicateIds,
    totalMismatch: matrix.total === required.length ? null : { expected: required.length, actual: matrix.total },
  };
}

function requirementIds(text) {
  const ids = [];
  for (const match of text.matchAll(/([A-Z]+)-(\d{2})(?:–(?:[A-Z]+-)?(\d{2}))?/g)) {
    const [, prefix, first, last] = match;
    const start = Number(first);
    const end = last ? Number(last) : start;
    for (let value = start; value <= end; value += 1) ids.push(`KSHVI-F-${prefix}-${String(value).padStart(2, '0')}`);
  }
  return ids;
}

function taskBlocks(plan) {
  const headings = [...plan.matchAll(/^### Task (\d+):/gm)];
  return headings.map((heading, index) => ({
    task: Number(heading[1]),
    text: plan.slice(heading.index, headings[index + 1]?.index ?? plan.length),
  }));
}

function testChecks(path) {
  if (!existsSync(path)) return [];
  const source = readFileSync(path, 'utf8');
  TEST_DECLARATION.lastIndex = 0;
  return [...source.matchAll(TEST_DECLARATION)].map(match => match[2]);
}

function existingTestPath(root, path) {
  const candidates = [path];
  if (path.startsWith('services/kshvi/tests/')) candidates.push(path.replace('services/kshvi/tests/', 'packages/kshvi/tests/'));
  if (path.startsWith('packages/kshvi/tests/')) candidates.push(path.replace('packages/kshvi/tests/', 'services/kshvi/tests/'));
  return candidates.find(candidate => testChecks(resolve(root, candidate)).length > 0) ?? null;
}

export function buildFunctionalMatrix({ specification, plan, root = process.cwd(), lastTask = 51 }) {
  const required = collectFunctionalIds(specification);
  const mappings = new Map(required.map(id => [id, { implementation: new Set(), tests: new Set(), evidence: new Set() }]));
  for (const block of taskBlocks(plan).filter(block => block.task <= lastTask)) {
    const filesText = block.text.split('**Files:**')[1]?.split('**Requirements:**')[0] ?? '';
    const requirementsText = block.text.split('**Requirements:**')[1]?.split(/\n\s*\n|\*\*Interfaces:\*\*/)[0] ?? '';
    const ids = requirementIds(requirementsText).filter(id => mappings.has(id));
    const implementation = [];
    const tests = [];
    let previousPath = '';
    const normalize = path => {
      if (/^(?:packages|crates|services|apps|scripts|docs)\//.test(path)) {
        previousPath = path;
        return path;
      }
      if (path.startsWith('src/') && previousPath) {
        const workspace = previousPath.match(/^((?:packages|services|apps|crates)\/[^/]+)\//)?.[1];
        if (workspace) {
          previousPath = `${workspace}/${path}`;
          return previousPath;
        }
      }
      if (!path.includes('/') && previousPath) {
        previousPath = `${previousPath.split('/').slice(0, -1).join('/')}/${path}`;
        return previousPath;
      }
      return path;
    };
    for (const match of filesText.matchAll(/(?:^|[;\n])\s*(?:-\s*)?(Create|Modify|Test):?\s*([^;\n]+)/g)) {
      const declaredTest = match[1] === 'Test';
      for (const rawPath of [...match[2].matchAll(/`([^`]+)`/g)].map(item => item[1])) {
        const path = normalize(rawPath);
        const testFile = declaredTest || /(?:\.test\.|\.spec\.)/.test(path);
        if (testFile) {
          const existing = existingTestPath(root, path);
          if (existing) tests.push(existing);
        } else if (/^(?:packages|crates|services|apps|scripts)\//.test(path) && safeFile(root, path)) implementation.push(path);
      }
    }
    for (const id of ids) {
      const mapping = mappings.get(id);
      for (const path of implementation) mapping.implementation.add(path);
      for (const path of tests) {
        mapping.tests.add(path);
        for (const check of testChecks(resolve(root, path))) mapping.evidence.add(`${path}#${check}`);
      }
    }
  }
  return {
    schemaVersion: 1,
    spec: 'docs/superpowers/specs/2026-11-20-kshvi-modern-design.md',
    plan: DEFAULT_PLAN,
    total: required.length,
    requirements: required.map(id => ({
      id,
      implementation: [...mappings.get(id).implementation].sort(),
      tests: [...mappings.get(id).tests].sort(),
      evidence: [...mappings.get(id).evidence].sort(),
    })),
  };
}

function parseArgs(argv) {
  const options = { spec: 'docs/superpowers/specs/2026-11-20-kshvi-modern-design.md', plan: DEFAULT_PLAN, output: 'docs/release/kshvi/functional-contract-matrix.json', requireTotal: 267, requireComplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--spec') options.spec = argv[++index];
    else if (arg === '--plan') options.plan = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--require-total') options.requireTotal = Number(argv[++index]);
    else if (arg === '--require-complete') options.requireComplete = true;
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return options;
}

function main(argv, cwd = process.cwd()) {
  const options = parseArgs(argv);
  const specification = readFileSync(resolve(cwd, options.spec), 'utf8');
  const plan = readFileSync(resolve(cwd, options.plan), 'utf8');
  const required = collectFunctionalIds(specification);
  if (required.length !== options.requireTotal) throw new Error(`Ожидалось ${options.requireTotal} функциональных требований, найдено ${required.length}`);
  const matrix = buildFunctionalMatrix({ specification, plan, root: cwd });
  matrix.spec = options.spec;
  matrix.plan = options.plan;
  const gaps = evaluateFunctionalMatrix(specification, matrix, { root: cwd, validateFiles: true });
  writeFileSync(resolve(cwd, options.output), `${JSON.stringify({ ...matrix, ...gaps }, null, 2)}\n`);
  const failed = gaps.unimplemented.length || gaps.missingTests.length || gaps.missingEvidence.length || gaps.unexpectedIds.length || gaps.duplicateIds.length || gaps.totalMismatch;
  console.log(JSON.stringify({ total: matrix.total, gaps, requireComplete: options.requireComplete }, null, 2));
  return options.requireComplete && failed ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
