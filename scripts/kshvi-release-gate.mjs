import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ID_PATTERN = /KSHVI-(?:F-[A-Z]+|NF|AC)-\d{2}/g;

export function requiredIds(specification) {
  return [...new Set(specification.match(ID_PATTERN) ?? [])];
}

export function releaseGaps(required, evidence) {
  return required.filter(id => {
    const record = evidence[id];
    return typeof record === 'string' ? record.length === 0 : !record;
  });
}

function safePath(root, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || isAbsolute(candidate)) return null;
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, candidate);
  const rel = relative(absoluteRoot, absolute);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return null;
  return absolute;
}

export function inspectEvidence(record, { root, currentCommit }) {
  const issues = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['INVALID_RECORD'];
  if (record.status !== 'passed') issues.push('STATUS');
  if (!record.commit || record.commit !== currentCommit) issues.push('STALE_COMMIT');
  if (typeof record.command !== 'string' || record.command.trim().length === 0) issues.push('COMMAND');
  const path = safePath(root, record.path);
  if (!path) {
    issues.push('UNSAFE_PATH');
  } else if (!existsSync(path)) {
    issues.push('MISSING_FILE');
  } else {
    try {
      const content = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(content.openErrors) && content.openErrors.length > 0) issues.push('OPEN_ERRORS');
    } catch {
      issues.push('INVALID_JSON');
    }
  }
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
    issues.push('ARTIFACTS');
  } else {
    for (const artifact of record.artifacts) {
      const artifactPath = safePath(root, artifact);
      if (!artifactPath) issues.push(`UNSAFE_ARTIFACT:${String(artifact)}`);
      else if (!existsSync(artifactPath)) issues.push(`MISSING_ARTIFACT:${artifact}`);
    }
  }
  return [...new Set(issues)];
}

function parseArgs(argv) {
  const options = { requireComplete: false, syncManifest: false, manifest: 'docs/release/kshvi/requirements.json', spec: 'docs/superpowers/specs/2026-11-20-kshvi-modern-design.md' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-complete') options.requireComplete = true;
    else if (arg === '--sync-manifest') options.syncManifest = true;
    else if (arg === '--manifest') options.manifest = argv[++index];
    else if (arg === '--spec') options.spec = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return options;
}

function loadManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (!manifest || !Array.isArray(manifest.entries)) throw new Error('В манифесте отсутствует entries');
  return manifest;
}

function syncManifest(path, specPath, ids) {
  const previous = existsSync(path) ? loadManifest(path) : { schemaVersion: 1 };
  const byId = new Map((previous.entries ?? []).map(entry => [entry.id, entry]));
  const manifest = {
    schemaVersion: 1,
    spec: specPath,
    entries: ids.map(id => ({
      id,
      status: byId.get(id)?.status ?? 'pending',
      evidence: byId.get(id)?.evidence ?? null,
    })),
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function evaluateManifest(manifest, ids, { root, currentCommit, requireComplete }) {
  const entries = manifest.entries ?? [];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const manifestIds = new Set(byId.keys());
  const problems = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      problems.push({ id, issues: ['MISSING_MANIFEST_ENTRY'] });
      continue;
    }
    if (entries.filter(candidate => candidate.id === id).length > 1) problems.push({ id, issues: ['DUPLICATE_MANIFEST_ENTRY'] });
    if (!requireComplete) continue;
    const issues = inspectEvidence(entry.evidence, { root, currentCommit });
    if (entry.status !== 'passed') issues.unshift('MANIFEST_STATUS');
    if (issues.length > 0) problems.push({ id, issues: [...new Set(issues)] });
  }
  if (manifestIds.size !== entries.length) problems.push({ id: 'MANIFEST', issues: ['DUPLICATE_IDS'] });
  for (const id of manifestIds) if (!ids.includes(id)) problems.push({ id, issues: ['UNEXPECTED_ID'] });
  return problems;
}

function main(argv, cwd) {
  const options = parseArgs(argv);
  const specPath = safePath(cwd, options.spec);
  const manifestPath = safePath(cwd, options.manifest);
  if (!specPath || !manifestPath) throw new Error('Пути спецификации и манифеста должны находиться внутри проекта');
  const ids = requiredIds(readFileSync(specPath, 'utf8'));
  if (options.syncManifest) {
    const manifest = syncManifest(manifestPath, options.spec, ids);
    console.log(`Манифест синхронизирован: ${manifest.entries.length} идентификаторов.`);
    return 0;
  }
  const manifest = loadManifest(manifestPath);
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const problems = evaluateManifest(manifest, ids, { root: cwd, currentCommit, requireComplete: options.requireComplete });
  if (problems.length > 0) {
    console.error(`Релиз заблокирован: ${problems.length} проблем.`);
    for (const problem of problems) console.error(`${problem.id}: ${problem.issues.join(', ')}`);
    return 1;
  }
  console.log(`Релизный барьер пройден: ${ids.length} идентификаторов.`);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(`Релиз заблокирован: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
