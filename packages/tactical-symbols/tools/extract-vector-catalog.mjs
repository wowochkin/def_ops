import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceArchiveEntries } from '../src/source/import-archive.ts';
import { sourceRegistry } from '../src/source/registry.ts';
import { assertContiguousCoverage, extractNumberedEntriesFromBBox, normalizeSourceEntries } from '../src/source/vector-extract.ts';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const archivePath = path.join(packageRoot, 'source', 'TacticalSignsRussianForces.zip');
const workRoot = path.join(packageRoot, '.work', 'vector-audit');
const reportPath = path.join(packageRoot, 'data', 'vector-catalog-report.json');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr ?? `код ${result.status}`}`);
  return result.stdout;
}

async function audit() {
  const { entries } = await readSourceArchiveEntries(archivePath);
  const entryByName = new Map(entries.map(entry => [entry.originalName, entry]));
  const documentsRoot = path.join(workRoot, 'documents');
  const pdfRoot = path.join(workRoot, 'pdf');
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(documentsRoot, { recursive: true });
  await mkdir(pdfRoot, { recursive: true });
  const documentPaths = [];
  for (const document of sourceRegistry.documents) {
    const entry = entryByName.get(document.originalName);
    assert(entry, `Не найден исходный ${document.originalName}`);
    const target = path.join(documentsRoot, document.normalizedName);
    await writeFile(target, entry.data);
    documentPaths.push(target);
  }
  run('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', pdfRoot, ...documentPaths]);

  const records = [];
  const emptyPages = [];
  for (const document of sourceRegistry.documents) {
    const pdfPath = path.join(pdfRoot, document.normalizedName.replace(/\.doc$/i, '.pdf'));
    const info = run('pdfinfo', [pdfPath]);
    const pagesMatch = info.match(/^Pages:\s+(\d+)$/m);
    assert(pagesMatch, `Неизвестно число страниц: ${document.originalName}`);
    const pageCount = Number(pagesMatch[1]);
    const bbox = run('pdftotext', ['-bbox-layout', pdfPath, '-']);
    const extracted = extractNumberedEntriesFromBBox(bbox);
    assert.equal((bbox.match(/<page\b/g) ?? []).length, pageCount, `Координаты и страницы не совпали: ${document.originalName}`);
    const pagesWithEntries = new Set(extracted.map(item => item.page));
    for (let page = 1; page <= pageCount; page += 1) if (!pagesWithEntries.has(page)) emptyPages.push(`${document.originalName} · страница ${page}`);
    for (const item of extracted) records.push({
      documentId: document.id, sourceDocument: document.originalName, page: item.page,
      number: item.number, text: item.text, x: item.x, y: item.y,
    });
  }

  const normalized = normalizeSourceEntries(records);
  let coverage;
  let error = null;
  try { coverage = assertContiguousCoverage(normalized.entries, [321, 322, 323]); } catch (cause) { error = cause.message; }
  const emptyText = normalized.entries.filter(record => !record.text).map(record => `${record.sourceDocument} · страница ${record.page} · знак ${record.number}`);
  const report = {
    schemaVersion: 1,
    archiveSha256: sourceRegistry.archive.sha256,
    documents: sourceRegistry.documents.length,
    pages: sourceRegistry.fragments.length,
    rawCandidates: records.length,
    extractedEntries: normalized.entries.length,
    coverage: coverage ?? null,
    sourceGaps: [{ numbers: [321, 322, 323], reason: 'Номера и изображения отсутствуют в поставленном DOC; не восстанавливаются предположительно.' }],
    status: error ? 'BLOCKED' : emptyText.length || emptyPages.length ? 'AUDITED_WITH_WARNINGS' : 'AUDITED',
    error,
    emptyPages,
    emptyText,
    discarded: normalized.discarded,
    entries: normalized.entries,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ documents: report.documents, pages: report.pages, rawCandidates: report.rawCandidates, extractedEntries: report.extractedEntries, coverage: report.coverage, status: report.status, error: report.error, discarded: normalized.discarded.length, emptyPages: emptyPages.length, emptyText: emptyText.length, report: reportPath }, null, 2));
  if (report.status === 'BLOCKED') process.exitCode = 1;
}

if (process.argv[2] !== '--audit') throw new Error('Использование: node tools/extract-vector-catalog.mjs --audit');
await audit();
