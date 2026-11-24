import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  importSourceArchive,
  readSourceArchiveEntries,
  verifyDerivedFiles,
} from '../src/source/import-archive.ts';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const archivePath = path.join(packageRoot, 'source', 'TacticalSignsRussianForces.zip');
const registryPath = path.join(packageRoot, 'data', 'source-registry.json');
const workRoot = path.join(packageRoot, '.work', 'import');
const fragmentsRoot = path.join(packageRoot, 'data', 'fragments');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`Не удалось выполнить ${command}: ${result.error?.message ?? result.stderr ?? `код ${result.status}`}`);
  }
  return result.stdout;
}

async function extractFragments() {
  const baseRegistry = await importSourceArchive(archivePath);
  const { entries } = await readSourceArchiveEntries(archivePath);
  const entryByName = new Map(entries.map(entry => [entry.originalName, entry]));
  const documentsRoot = path.join(workRoot, 'documents');
  const pdfRoot = path.join(workRoot, 'pdf');
  const renderedRoot = path.join(workRoot, 'rendered');
  await rm(workRoot, { recursive: true, force: true });
  await rm(fragmentsRoot, { recursive: true, force: true });
  await mkdir(documentsRoot, { recursive: true });
  await mkdir(pdfRoot, { recursive: true });
  await mkdir(renderedRoot, { recursive: true });
  await mkdir(fragmentsRoot, { recursive: true });

  const documentPaths = [];
  for (const document of baseRegistry.documents) {
    const entry = entryByName.get(document.originalName);
    assert(entry, `Не найдена запись ${document.originalName}`);
    const documentPath = path.join(documentsRoot, document.normalizedName);
    await writeFile(documentPath, entry.data);
    documentPaths.push(documentPath);
  }
  run('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', pdfRoot, ...documentPaths]);

  const fragments = [];
  for (const document of baseRegistry.documents) {
    const baseName = document.normalizedName.replace(/\.doc$/i, '');
    const pdfPath = path.join(pdfRoot, `${baseName}.pdf`);
    const info = run('pdfinfo', [pdfPath]);
    const pagesMatch = info.match(/^Pages:\s+(\d+)$/m);
    assert(pagesMatch, `Не удалось определить число страниц: ${document.originalName}`);
    const pageCount = Number(pagesMatch[1]);
    const textPath = path.join(workRoot, `${baseName}.txt`);
    run('pdftotext', ['-layout', pdfPath, textPath]);
    const pagesText = (await readFile(textPath, 'utf8')).replaceAll('\r\n', '\n').split('\f');
    if (pagesText.at(-1)?.trim() === '') pagesText.pop();
    assert.equal(pagesText.length, pageCount, `Текст и страницы не совпали: ${document.originalName}`);

    const documentRenderRoot = path.join(renderedRoot, document.id);
    const documentFragmentRoot = path.join(fragmentsRoot, document.id);
    await mkdir(documentRenderRoot, { recursive: true });
    await mkdir(documentFragmentRoot, { recursive: true });
    run('pdftoppm', [
      '-jpeg', '-r', '110', '-jpegopt', 'quality=88',
      pdfPath, path.join(documentRenderRoot, 'page'),
    ]);
    const renderedNames = (await readdir(documentRenderRoot)).filter(name => name.endsWith('.jpg'));
    assert.equal(renderedNames.length, pageCount, `Изображения и страницы не совпали: ${document.originalName}`);
    const renderedByPage = new Map(renderedNames.map(name => {
      const match = name.match(/-(\d+)\.jpg$/);
      assert(match, `Не удалось определить страницу изображения: ${name}`);
      return [Number(match[1]), name];
    }));

    for (let page = 1; page <= pageCount; page += 1) {
      const suffix = String(page).padStart(3, '0');
      const fileName = `page-${suffix}.jpg`;
      const relativePath = `data/fragments/${document.id}/${fileName}`;
      const targetPath = path.join(packageRoot, relativePath);
      const renderedName = renderedByPage.get(page);
      assert(renderedName, `Отсутствует изображение страницы ${page}: ${document.originalName}`);
      await copyFile(path.join(documentRenderRoot, renderedName), targetPath);
      const image = await readFile(targetPath);
      const { createHash } = await import('node:crypto');
      const sha256 = createHash('sha256').update(image).digest('hex');
      const ruleText = pagesText[page - 1].trim() || null;
      fragments.push({
        id: `${document.id}-page-${suffix}`,
        documentId: document.id,
        sourceDocument: document.originalName,
        page,
        symbolNumber: null,
        referenceFragment: { format: 'JPEG', path: relativePath, sha256 },
        ruleText,
        textScope: 'PAGE',
        status: 'IMPORTED',
        gaps: [
          'Это эталонная страница, а не вырезанный и сопоставленный отдельный знак; номер знака требует ручной сверки.',
          ...(ruleText ? [] : ['Текст страницы не извлечён автоматически; содержание доступно только на изображении.']),
        ],
      });
    }
  }
  return fragments;
}

async function checkRegistry() {
  const existing = JSON.parse(await readFile(registryPath, 'utf8'));
  const imported = await importSourceArchive(archivePath, {
    fragments: existing.fragments,
    gaps: existing.gaps,
  });
  assert.deepStrictEqual(imported, existing, 'Реестр не соответствует повторному импорту архива');
  const { checked } = await verifyDerivedFiles(existing, packageRoot);
  console.log(`Проверено: ${existing.documents.length} DOC, ${existing.fonts.length} TTF, ${checked} фрагментов; SHA-256 совпадают.`);
}

const mode = process.argv[2] ?? '--check';
if (mode === '--extract') {
  const fragments = await extractFragments();
  const registry = await importSourceArchive(archivePath, { fragments });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`Сформирован реестр: ${registry.documents.length} DOC, ${registry.fonts.length} TTF, ${registry.fragments.length} страничных фрагментов.`);
  await checkRegistry();
} else if (mode === '--check') {
  await checkRegistry();
} else {
  throw new Error('Использование: node tools/import-source.mjs --extract | --check');
}
