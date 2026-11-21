import { describe, expect, it } from 'vitest';
import {
  coverageReport,
  importSourceArchive,
  sourceRegistry,
  verifyArchive,
  verifyDerivedFiles,
} from '../src/source/index';

const archivePath = 'packages/tactical-symbols/source/TacticalSignsRussianForces.zip';
const expectedSha256 = '123731284d4fd3ed3c3963afe457f1cf3cdb34db500a38cdc33451ca2ddc6331';

describe('реестр источника тактических знаков', () => {
  it('фиксирует исходный архив и все документы', async () => {
    expect(await verifyArchive(archivePath)).toBe(expectedSha256);
    expect(coverageReport()).toMatchObject({
      documents: 29,
      fonts: 2,
      missingDocuments: [],
    });
  });

  it('отклоняет архив с другим контрольным хешем', async () => {
    await expect(verifyArchive(archivePath, '0'.repeat(64))).rejects.toThrow('SHA-256');
  });

  it('воспроизводимо декодирует имена и не создаёт дубликаты при повторе', async () => {
    const first = await importSourceArchive(archivePath);
    const second = await importSourceArchive(archivePath);

    expect(first).toEqual(second);
    expect(first.archive.sha256).toBe(expectedSha256);
    expect(first.documents).toHaveLength(29);
    expect(first.fonts).toHaveLength(2);
    expect(first.documents.map(document => document.originalName)).toContain('01ПУ.doc');
    expect(new Set(first.documents.map(document => document.normalizedName)).size).toBe(29);
    expect(first.documents.every(document => /^[a-f0-9]{64}$/.test(document.sha256))).toBe(true);
    expect(first.fonts.every(font => /^[a-f0-9]{64}$/.test(font.sha256))).toBe(true);
  });

  it('покрывает все тематические группы и раскрывает незавершённую пообъектную сверку', () => {
    const report = coverageReport();
    expect(report).toMatchObject({
      documentsWithFragments: 29,
      uncoveredTopics: [],
      status: 'PARTIAL',
    });
    expect(report.unmappedFragments).toBe(sourceRegistry.fragments.length);
    expect(sourceRegistry.fragments.length).toBeGreaterThan(29);
    expect(sourceRegistry.fragments.every(fragment => fragment.status === 'IMPORTED')).toBe(true);
    expect(sourceRegistry.fragments.every(fragment => fragment.symbolNumber === null)).toBe(true);
    expect(sourceRegistry.gaps.length).toBeGreaterThan(0);
  });

  it('связывает каждый фрагмент с документом, страницей и проверяемым файлом', async () => {
    const documentIds = new Set(sourceRegistry.documents.map(document => document.id));
    for (const fragment of sourceRegistry.fragments) {
      expect(documentIds.has(fragment.documentId)).toBe(true);
      expect(fragment.page).toBeGreaterThan(0);
      expect(fragment.referenceFragment.path).toMatch(/\.jpg$/);
      expect(fragment.referenceFragment.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fragment.ruleText === null || fragment.ruleText.length > 0).toBe(true);
      expect(fragment.gaps).not.toHaveLength(0);
    }
    await expect(verifyDerivedFiles()).resolves.toEqual({ checked: sourceRegistry.fragments.length });
  });
});
