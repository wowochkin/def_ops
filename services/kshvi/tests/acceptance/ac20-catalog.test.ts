import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { analyzeCatalog, loadCatalog, REQUIRED_CATEGORIES, type CatalogReport, type CatalogTemplate } from '../../../../scripts/kshvi-catalog-content-check.mjs';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

function issueCodes(report: CatalogReport): string[] {
  return (report.issues as { code: string }[]).map(issue => issue.code);
}
function clone(template: CatalogTemplate): CatalogTemplate {
  return structuredClone(template);
}

it('AC-20: каталог содержит 240 различных исправных механизмов и отклоняет дефектные записи', { timeout: 120_000 }, async () => {
  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  const directory = runId ? 'docs/release/kshvi/evidence/ac20' : '.tmp/ac20';
  await mkdir(directory, { recursive: true });
  const qualityPath = `${directory}/catalog-quality.json`;
  const defectsPath = `${directory}/defects.json`;
  execFileSync(process.execPath, ['scripts/kshvi-catalog-content-check.mjs', '--output', qualityPath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const report = JSON.parse(await readFile(qualityPath, 'utf8')) as CatalogReport;
  const loaded = await loadCatalog('packages/kshvi-events/data/catalog');

  expect(report.valid).toBe(true);
  expect(report.issues).toEqual([]);
  expect(report.totalTemplates).toBeGreaterThanOrEqual(240);
  expect(report.approvedDistinct).toBeGreaterThanOrEqual(240);
  expect(report.requiredCategories).toHaveLength(12);
  expect(report.requiredCategories.map((entry: { category: string }) => entry.category).sort()).toEqual([...REQUIRED_CATEGORIES].sort());
  for (const category of report.requiredCategories as { category: string; approvedDistinct: number }[]) {
    expect(category.approvedDistinct, category.category).toBeGreaterThanOrEqual(20);
  }
  expect(loaded.manifest).not.toBeNull();
  expect(loaded.manifest?.templates).toHaveLength(loaded.templates.length);
  expect(loaded.manifest?.reviewStatus).toBe('APPROVED');
  const manifestById = new Map((loaded.manifest?.templates ?? []).map((entry: { templateId: string }) => [entry.templateId, entry]));
  const templateById = new Map(loaded.templates.map(template => [template.templateId, template]));
  expect(templateById.size).toBe(loaded.templates.length);
  expect(new Set(report.mechanismFingerprints.map((entry: { hash: string }) => entry.hash)).size).toBe(report.approvedDistinct);

  expect(report.rehearsals).toHaveLength(loaded.templates.length);
  for (const rehearsal of report.rehearsals as { templateId: string; file: string; suitable: { outcome: string; evidence: unknown[] }; unsuitable: { outcome: string; reasonCode?: string } }[]) {
    const template = templateById.get(rehearsal.templateId);
    const manifest = manifestById.get(rehearsal.templateId);
    expect(template, rehearsal.templateId).toBeDefined();
    expect(manifest, rehearsal.templateId).toBeDefined();
    expect(manifest).toMatchObject({ reviewStatus: 'APPROVED', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), mechanismHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(existsSync(`packages/kshvi-events/data/catalog/${rehearsal.file}`), rehearsal.file).toBe(true);
    expect(rehearsal.suitable.outcome, rehearsal.templateId).toBe('APPLIED');
    expect(rehearsal.suitable.evidence.length, rehearsal.templateId).toBeGreaterThan(0);
    expect(rehearsal.unsuitable.outcome, rehearsal.templateId).toBe('REJECTED');
    expect(rehearsal.unsuitable.reasonCode, rehearsal.templateId).toBeTruthy();
  }

  const original = loaded.templates[0]!;
  original.cascade.allowedFollowUpTemplateIds = [];
  const numericClone = clone(original);
  numericClone.templateId = 'defect-numeric-clone';
  numericClone.name = 'Переименованный числовой клон';
  numericClone.description = 'Другой текст без нового механизма.';
  numericClone.weight = 999;
  numericClone.parameters[0].min = 1;
  numericClone.parameters[0].max = 999;
  numericClone.parameters[0].default = 77;
  numericClone.effects[0].target.ref = 'renamed-target';

  const missingProvenance = clone(original);
  missingProvenance.templateId = 'defect-missing-provenance';
  delete missingProvenance.source;
  delete missingProvenance.trainingAssumption;

  const unknownEffect = clone(original);
  unknownEffect.templateId = 'defect-unknown-effect';
  unknownEffect.effects[0].type = 'executeJavaScript';

  const negativeResource = clone(original);
  negativeResource.templateId = 'defect-negative-resource';
  negativeResource.effects[0] = {
    type: 'consumeResource', target: { domain: 'resources', ref: 'fuel' }, resourceKind: 'FUEL',
    quantityParameter: negativeResource.parameters[0].id, allowNegative: true,
  };

  const cycleA = clone(original);
  const cycleB = clone(original);
  cycleA.templateId = 'defect-cycle-a';
  cycleB.templateId = 'defect-cycle-b';
  cycleA.cascade.allowedFollowUpTemplateIds = [cycleB.templateId];
  cycleB.cascade.allowedFollowUpTemplateIds = [cycleA.templateId];

  const missingCompensation = clone(original);
  missingCompensation.templateId = 'defect-missing-compensation';
  missingCompensation.compensations = [];

  const badRehearsal = clone(original);
  badRehearsal.templateId = 'defect-bad-rehearsal';
  badRehearsal.rehearsal.unsuitableFacts = structuredClone(badRehearsal.rehearsal.suitableFacts);

  const defects = analyzeCatalog({
    templates: [original, numericClone, missingProvenance, unknownEffect, negativeResource, cycleA, cycleB, missingCompensation, badRehearsal],
    sources: loaded.sources, requireMinimum: 9, requirePerCategory: 0,
  });
  const codes = issueCodes(defects);
  const expectedDefectCodes = [
    'DUPLICATE_MECHANISM', 'MISSING_PROVENANCE', 'UNKNOWN_EFFECT', 'NEGATIVE_RESOURCE',
    'CASCADE_CYCLE', 'MISSING_COMPENSATION', 'UNSUITABLE_STATE_ACCEPTED',
  ];
  expect(defects.valid).toBe(false);
  for (const code of expectedDefectCodes) expect(codes).toContain(code);
  await writeFile(defectsPath, JSON.stringify({ expectedDefectCodes, actualIssueCodes: [...new Set(codes)].sort(), report: defects }, null, 2));

  if (!runId) return;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const initialRevision = { id: loaded.manifest!.catalogId, revision: 1, sha256: hashCanonical(loaded.manifest) };
  const journalSha256 = hashCanonical(report);
  const metrics = {
    templates: report.totalTemplates, distinctMechanisms: report.approvedDistinct, categories: report.requiredCategories.length,
    successfulSuitableRehearsals: report.rehearsals.filter((entry: { suitable: { outcome: string } }) => entry.suitable.outcome === 'APPLIED').length,
    rejectedUnsuitableRehearsals: report.rehearsals.filter((entry: { unsuitable: { outcome: string } }) => entry.unsuitable.outcome === 'REJECTED').length,
    defectChecksRejected: expectedDefectCodes.length, openCatalogIssues: report.issues.length,
  };
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-20 завершён\nrunId: ${runId}\ncommit: ${commit}\n240 записей и 240 различных механизмов; 12 категорий по 20; каждая запись применена в подходящем состоянии и отклонена в неподходящем; дефекты ${expectedDefectCodes.join(', ')} отклонены.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-20.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: qualityPath, sha256: journalSha256, eventCount: report.rehearsals.length },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical(loaded.sources), journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Автоматическая проверка доказывает схему, уникальность механизма и репетиции, но не заменяет независимую методическую оценку содержания по AC-30.'],
    artifacts: [qualityPath, defectsPath, protocolPath, metricsPath],
  }, null, 2));
});
