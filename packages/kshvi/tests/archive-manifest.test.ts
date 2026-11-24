import { expect, it } from 'vitest';
import {
  ARCHIVE_COMPONENTS,
  archiveManifestHash,
  createArchiveManifest,
  materializeArchiveFiles,
  sha256File,
} from '../src/archive/archive-manifest';
import { validateArchivePaths, validateArchiveSchema } from '../src/archive/archive-schema';
import { completeComponents, manifestInput } from './fixtures/archive-fixture';

it('манифест содержит все обязательные компоненты, SHA-256 файлов и контрольную сумму', () => {
  const input = manifestInput();
  const manifest = createArchiveManifest(input);
  const files = materializeArchiveFiles(input.components);
  for (const id of [
    'exercise.card', 'snapshots.initial', 'snapshots.intermediate', 'snapshots.final', 'journal.events', 'journal.hash-chain',
    'environment.map', 'environment.tiles', 'environment.elevations', 'environment.weather', 'environment.terrain-history', 'environment.attribution',
    'forces.morale-psych', 'forces.readiness-activities', 'logistics.supply-movements', 'logistics.repair-evacuation',
    'scheduler.candidates', 'scheduler.random-keys', 'agents.decision-traces', 'agents.variant-runs', 'symbols.vector-definitions',
    'models.algorithm-versions', 'assessments.sheets', 'debriefs.materials', 'research.cards', 'branches.comparisons', 'viewer.engine',
  ]) expect(manifest.components.some(component => component.id === id), id).toBe(true);
  for (const component of manifest.components) {
    expect(component.sha256).toBe(sha256File(files[component.path]));
    expect(component.bytes).toBe(files[component.path].length);
  }
  expect(manifest.manifestSha256).toBe(archiveManifestHash(manifest));
  expect(manifest.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(ARCHIVE_COMPONENTS.length).toBeGreaterThanOrEqual(55);
  expect(validateArchiveSchema(manifest)).toEqual([]);
  expect(validateArchivePaths(manifest)).toEqual([]);
});

it('производный показ имеет другой идентификатор и не меняет официальный архив', () => {
  const official = createArchiveManifest(manifestInput());
  const before = official.manifestSha256;
  const expositionInput = manifestInput({
    archiveId: 'archive-exposition-1', kind: 'EXPOSITION', originArchiveId: official.archiveId,
    components: completeComponents(true),
  });
  expositionInput.components['exposition.program'].data = JSON.stringify({ title: 'Изменённая программа показа' });
  const exposition = createArchiveManifest(expositionInput);
  expect(exposition.archiveId).not.toBe(official.archiveId);
  expect(exposition.originArchiveId).toBe(official.archiveId);
  expect(exposition.components.some(component => component.id === 'exposition.program')).toBe(true);
  expect(exposition.components.some(component => component.id === 'exposition.explanations')).toBe(true);
  expect(exposition.components.some(component => component.id === 'exposition.audience-policy')).toBe(true);
  expect(official.manifestSha256).toBe(before);
});

it('отклоняет небезопасные пути и неподдерживаемую схему', () => {
  const input = manifestInput();
  input.components['exercise.card'].path = '../outside.json';
  const manifest = createArchiveManifest(input);
  expect(validateArchivePaths(manifest)).toContain('exercise.card');
  expect(validateArchiveSchema({ ...manifest, schemaVersion: 999 })).toContain('Неподдерживаемая версия схемы архива');
});
