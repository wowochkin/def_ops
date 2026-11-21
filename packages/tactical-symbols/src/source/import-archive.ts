import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import {
  SOURCE_ARCHIVE_SHA256,
  sourceRegistry,
  type SourceDocumentRecord,
  type SourceFontRecord,
  type SourceRegistry,
  type SourceTopic,
  type SymbolSourceFragment,
} from './registry.ts';

export interface SourceArchiveEntry {
  readonly originalName: string;
  readonly data: Buffer;
  readonly sha256: string;
}

interface ImportOptions {
  readonly fragments?: readonly SymbolSourceFragment[];
  readonly gaps?: readonly string[];
}

const defaultGaps = [
  'Реестр содержит страничные фрагменты, а не доказанный перечень всех отдельных знаков.',
  'Номер отдельного знака и его правило не сопоставляются автоматически; требуется ручная пообъектная сверка.',
  'Наличие документа в архиве не подтверждает современную нормативную полноту или действующую редакцию.',
  'Статус IMPORTED не означает векторный перенос, визуальную сверку или методическое утверждение.',
] as const;

function digest(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const transliteration: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

function normalizedFileName(id: string, originalName: string): string {
  const extension = originalName.toLowerCase().endsWith('.ttf') ? '.ttf' : '.doc';
  const base = originalName.slice(0, -extension.length).normalize('NFC').toLowerCase();
  const slug = Array.from(base, character => transliteration[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'material';
  return `${id}-${slug}${extension}`;
}

function topicsFor(originalName: string): readonly SourceTopic[] {
  if (originalName.includes('передвиж')) return ['MOVEMENT'];
  if (originalName.startsWith('01ПУ')) return ['COMMAND_POSTS'];
  if (originalName.startsWith('02разг')) return ['BOUNDARY_LINES'];
  if (originalName.startsWith('04 ')) return ['GROUND_FORCES'];
  if (originalName.startsWith('05 ')) return ['AIR_FORCES'];
  if (originalName.startsWith('06 ')) return ['NAVY'];
  if (originalName.startsWith('07 ')) return ['STRATEGIC_MISSILE_FORCES'];
  if (originalName.startsWith('08 ')) return ['SPACE_FORCES'];
  if (originalName.startsWith('0901')) return ['RECONNAISSANCE'];
  if (originalName.startsWith('0902')) return ['SIGNALS'];
  if (originalName.startsWith('0903')) return ['ELECTRONIC_WARFARE'];
  if (originalName.startsWith('0904')) return ['CAMOUFLAGE'];
  if (originalName.startsWith('0905')) return ['NUCLEAR_SUPPORT'];
  if (originalName.startsWith('0906')) return ['ENGINEER_SUPPORT'];
  if (originalName.startsWith('0907')) return ['CBRN_PROTECTION'];
  if (originalName.startsWith('0908')) return ['TOPOGEODETIC_SUPPORT'];
  if (originalName.startsWith('0909')) return ['HYDROMETEOROLOGICAL_SUPPORT'];
  if (originalName.startsWith('0910') || originalName.startsWith('Усл.знаки МПО')) return ['MORAL_PSYCHOLOGICAL_SUPPORT'];
  if (originalName.startsWith('0911')) return ['TECHNICAL_SUPPORT'];
  if (originalName.startsWith('10 ')) return ['LOGISTICS_SUPPORT'];
  return ['OTHER_ORGANIZATIONS'];
}

function decodeArchiveEntries(archive: Buffer): readonly SourceArchiveEntry[] {
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('В архиве не найден центральный каталог ZIP');

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  let centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > archive.length) throw new Error('Повреждён центральный каталог ZIP');

  const entries: SourceArchiveEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('Повреждена запись центрального каталога ZIP');
    const flags = archive.readUInt16LE(centralOffset + 8);
    const compression = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
    const fileNameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    if ((flags & 1) !== 0 || [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
      throw new Error('Шифрованные и ZIP64-записи не поддерживаются');
    }

    const nameBytes = archive.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength);
    const decoder = new TextDecoder((flags & 0x800) !== 0 ? 'utf-8' : 'ibm866', { fatal: true });
    const originalName = decoder.decode(nameBytes).normalize('NFC');
    if (!originalName || originalName === '..' || originalName.includes('/') || originalName.includes('\\')) {
      throw new Error(`Небезопасное имя записи ZIP: ${originalName || '<пустое>'}`);
    }
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Повреждён локальный заголовок: ${originalName}`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    if (compressed.length !== compressedSize) throw new Error(`Обрезаны данные записи: ${originalName}`);
    if (compression !== 0 && compression !== 8) throw new Error(`Неподдерживаемое сжатие записи: ${originalName}`);
    const data = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    if (data.length !== uncompressedSize) throw new Error(`Размер записи после распаковки не совпал: ${originalName}`);
    entries.push({ originalName, data, sha256: digest(data) });
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

export async function verifyArchive(
  archivePath: string,
  expectedSha256: string = SOURCE_ARCHIVE_SHA256,
): Promise<string> {
  const actualSha256 = digest(await readFile(archivePath));
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA-256 архива не совпадает: ожидался ${expectedSha256}, получен ${actualSha256}`);
  }
  return actualSha256;
}

export async function readSourceArchiveEntries(archivePath: string) {
  const sha256 = await verifyArchive(archivePath);
  return { sha256, entries: decodeArchiveEntries(await readFile(archivePath)) };
}

export async function importSourceArchive(
  archivePath: string,
  options: ImportOptions = {},
): Promise<SourceRegistry> {
  const { entries } = await readSourceArchiveEntries(archivePath);
  const documentEntries = entries.filter(entry => entry.originalName.toLowerCase().endsWith('.doc'));
  const fontEntries = entries.filter(entry => entry.originalName.toLowerCase().endsWith('.ttf'));
  if (entries.length !== 31 || documentEntries.length !== 29 || fontEntries.length !== 2) {
    throw new Error(`Состав архива должен быть ровно 29 DOC и 2 TTF; получено ${documentEntries.length} DOC и ${fontEntries.length} TTF, всего записей ${entries.length}`);
  }

  documentEntries.sort((left, right) => compareNames(left.originalName, right.originalName));
  fontEntries.sort((left, right) => compareNames(left.originalName, right.originalName));
  const fragments = [...(options.fragments ?? [])].sort((left, right) => compareNames(left.id, right.id));
  const fragmentIds = new Set<string>();
  for (const fragment of fragments) {
    if (fragmentIds.has(fragment.id)) throw new Error(`Дубликат фрагмента источника: ${fragment.id}`);
    fragmentIds.add(fragment.id);
  }

  const documents: SourceDocumentRecord[] = documentEntries.map((entry, index) => {
    const id = `doc-${String(index + 1).padStart(3, '0')}`;
    const ownFragments = fragments.filter(fragment => fragment.documentId === id);
    return {
      id,
      originalName: entry.originalName,
      normalizedName: normalizedFileName(id, entry.originalName),
      sha256: entry.sha256,
      byteLength: entry.data.length,
      topics: topicsFor(entry.originalName),
      fragmentIds: ownFragments.map(fragment => fragment.id),
      status: 'IMPORTED',
      coverage: ownFragments.length > 0 ? 'FRAGMENTS_EXTRACTED' : 'REGISTERED',
      gaps: [ownFragments.length > 0
        ? 'Страничные фрагменты не заменяют пообъектную сверку знаков, номеров и правил.'
        : 'Страничные фрагменты ещё не извлечены.'],
    };
  });
  const documentById = new Map(documents.map(document => [document.id, document]));
  for (const fragment of fragments) {
    const document = documentById.get(fragment.documentId);
    if (!document) throw new Error(`Фрагмент ${fragment.id} ссылается на неизвестный документ ${fragment.documentId}`);
    if (fragment.sourceDocument !== document.originalName) {
      throw new Error(`Фрагмент ${fragment.id} имеет неверное исходное имя документа`);
    }
  }

  const fonts: SourceFontRecord[] = fontEntries.map((entry, index) => {
    const id = `font-${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      originalName: entry.originalName,
      normalizedName: normalizedFileName(id, entry.originalName),
      sha256: entry.sha256,
      byteLength: entry.data.length,
      runtimeRequired: false,
    };
  });

  return {
    schemaVersion: 1,
    archive: {
      fileName: 'TacticalSignsRussianForces.zip',
      sha256: SOURCE_ARCHIVE_SHA256,
      documentCount: 29,
      fontCount: 2,
    },
    documents,
    fonts,
    fragments,
    gaps: [...(options.gaps ?? defaultGaps)],
  };
}

export async function verifyDerivedFiles(
  registry: SourceRegistry = sourceRegistry,
  packageRoot = fileURLToPath(new URL('../../', import.meta.url)),
): Promise<{ checked: number }> {
  const root = packageRoot.replace(/\/$/, '');
  for (const fragment of registry.fragments) {
    const data = await readFile(`${root}/${fragment.referenceFragment.path}`);
    const actualSha256 = digest(data);
    if (actualSha256 !== fragment.referenceFragment.sha256) {
      throw new Error(`SHA-256 производного фрагмента не совпадает: ${fragment.referenceFragment.path}`);
    }
  }
  return { checked: registry.fragments.length };
}
