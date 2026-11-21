import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeCatalog,
  loadCatalog,
  REQUIRED_CATEGORIES,
  type CatalogReport,
  type CatalogTemplate,
} from '../../../scripts/kshvi-catalog-content-check.mjs';

const catalogDirectory = resolve('packages/kshvi-events/data/catalog');
const loaded = await loadCatalog(catalogDirectory);
const report = analyzeCatalog({
  ...loaded,
  requireManifest: true,
  requireMinimum: 240,
  requirePerCategory: 20,
});

function categoryCounts(value: CatalogReport) {
  return Object.fromEntries(value.requiredCategories.map((entry: Record<string, any>) => [
    entry.category,
    entry.approvedDistinct,
  ]));
}

describe('целевой каталог AUTO-02', () => {
  it('содержит не менее 240 различных событий и не менее 20 в каждой категории', () => {
    const counts = categoryCounts(report);
    expect(report.approvedDistinct, JSON.stringify(counts)).toBeGreaterThanOrEqual(240);
    expect(Object.keys(counts).sort()).toEqual([...REQUIRED_CATEGORIES].sort());
    for (const category of report.requiredCategories) {
      expect(category.approvedDistinct, category.category).toBeGreaterThanOrEqual(20);
    }
    expect(report.issues).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('имеет манифест с записью и SHA-256 для каждого шаблона', () => {
    expect(loaded.manifest).not.toBeNull();
    expect(loaded.manifest?.templates).toHaveLength(loaded.templates.length);
    expect(loaded.manifest?.totals.approvedDistinct).toBe(report.approvedDistinct);
    for (const entry of loaded.manifest?.templates || []) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.mechanismHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.reviewStatus).toBe('APPROVED');
    }
  });

  it('содержит успешную подходящую и отклонённую неподходящую репетицию каждой записи', () => {
    expect(report.rehearsals).toHaveLength(loaded.templates.length);
    for (const rehearsal of report.rehearsals) {
      expect(rehearsal.file, rehearsal.templateId).toMatch(/\.json$/);
      expect(rehearsal.suitable.outcome, rehearsal.templateId).toBe('APPLIED');
      expect(rehearsal.suitable.evidence.length, rehearsal.templateId).toBeGreaterThan(0);
      expect(rehearsal.unsuitable.outcome, rehearsal.templateId).toBe('REJECTED');
    }
  });

  it('не содержит исторических нормативов или психодиагностики реальных людей', () => {
    for (const template of loaded.templates as CatalogTemplate[]) {
      const serialized = JSON.stringify(template);
      expect(template.trainingAssumption, template.templateId).toMatch(/[А-Яа-яЁё]/);
      expect(serialized).not.toMatch(/историческ(?:ий|ого|ому) норматив/i);
      expect(serialized).not.toMatch(/диагностир\w* реальн\w* (?:участник|человек|люд)/i);
      expect(template.review.method).toBe('AUTHOR_METHODICAL_REVIEW_WITH_INDEPENDENT_AUTOMATED_CHECK');
    }
  });
});
