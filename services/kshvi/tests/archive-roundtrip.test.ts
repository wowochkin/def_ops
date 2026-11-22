import { expect, it } from 'vitest';
import { restoreAt } from '../../../packages/kshvi/src/replay/replay-engine';
import type { ReplayArchive } from '../../../packages/kshvi/src/replay/types';
import { completeComponents, archiveVersions, makeArchiveBundle } from '../../../packages/kshvi/tests/fixtures/archive-fixture';
import { fullArchivePolicyAdapter } from './helpers/archive-policy';
import { exportArchive, serializeArchive, deserializeArchive } from '../src/archive/archive-exporter';
import { verifyArchive } from '../src/archive/integrity-check';
import { importArchive } from '../src/archive/archive-importer';
import { filterParticipantsForExport } from '../src/archive/retention-export';

const actor = { organizationId: 'org-1', userId: 'exporter-1', authorities: ['archive.export'] };
const importActor = { organizationId: 'org-1', userId: 'importer-1', authorities: ['archive.import', 'archive.publish'] };

function exported() {
  return exportArchive({
    actor, organizationId: 'org-1', archiveId: 'archive-official-1', kind: 'OFFICIAL', createdAt: '2026-11-21T12:00:00.000Z',
    versions: archiveVersions, components: completeComponents(), policyAdapter: fullArchivePolicyAdapter,
    atlasLicense: { offlineExport: true, attribution: 'Локальный атлас' },
  });
}

it('полный автономный круговой цикл сохраняет хеши и контрольные точки реплея', () => {
  const archive = exported();
  expect(verifyArchive(archive)).toMatchObject({ valid: true, autonomous: true, mode: 'AUTONOMOUS', missing: [], corrupted: [], brokenReferences: [] });
  const restored = deserializeArchive(serializeArchive(archive));
  expect(verifyArchive(restored).manifestSha256).toBe(archive.manifest.manifestSha256);
  const decode = (bundle: typeof archive) => JSON.parse(new TextDecoder().decode(bundle.files['replay/archive.json'])) as ReplayArchive;
  expect(restoreAt({ archive: decode(restored), cursor: 3 }).stateHash).toBe(restoreAt({ archive: decode(archive), cursor: 3 }).stateHash);
});

it('неполный пакет доступен только для ограниченного исследования', () => {
  const components = completeComponents();
  delete components['environment.weather'];
  const bundle = makeArchiveBundle({ components });
  const result = verifyArchive(bundle);
  expect(result.autonomous).toBe(false);
  expect(result.missing).toContain('environment.weather');
  expect(result.mode).toBe('LIMITED_RESEARCH');
  const imported = importArchive(serializeArchive(bundle), importActor);
  expect(imported.publicationEligible).toBe(false);
  expect(imported.mode).toBe('LIMITED_RESEARCH');
});

it('до публикации обнаруживает изменённый файл, битую ссылку и старую схему', () => {
  const changed = exported();
  changed.files['journal/events.json'] = new TextEncoder().encode('{"changed":true}');
  expect(verifyArchive(changed)).toMatchObject({ valid: false, mode: 'REJECTED' });
  expect(verifyArchive(changed).corrupted).toContain('journal/events.json');
  expect(() => importArchive(serializeArchive(changed), importActor)).toThrow('повреждён');

  const broken = exported();
  broken.manifest.components.find(component => component.id === 'journal.hash-chain')!.references = ['missing.json'];
  broken.manifest.manifestSha256 = '';
  expect(verifyArchive(broken).brokenReferences).toContain('missing.json');
  expect(verifyArchive(broken).mode).toBe('REJECTED');
  expect(verifyArchive({ ...broken, manifest: { ...broken.manifest, schemaVersion: 999 } }).errors.join(' ')).toContain('схемы');
});

it('не обходит права и лицензию атласа, а ссылочный экспорт явно неавтономен', () => {
  expect(() => exportArchive({
    actor: { organizationId: 'org-1', userId: 'forbidden', authorities: [] }, organizationId: 'org-1', archiveId: 'x', kind: 'OFFICIAL', createdAt: 'x',
    versions: archiveVersions, components: completeComponents(), policyAdapter: fullArchivePolicyAdapter,
    atlasLicense: { offlineExport: true, attribution: 'x' },
  })).toThrow('403');
  expect(() => exportedWithOrgMismatch()).toThrow('403');
  const limited = exportArchive({
    actor, organizationId: 'org-1', archiveId: 'archive-reference', kind: 'OFFICIAL', createdAt: '2026-11-21T12:00:00.000Z',
    versions: archiveVersions, components: completeComponents(), policyAdapter: fullArchivePolicyAdapter, allowReferenceOnly: true,
    atlasLicense: { offlineExport: false, attribution: 'Ограниченный атлас', reference: { style: 'local-style' } },
  });
  expect(limited.manifest.omissions.some(item => item.componentId === 'environment.tiles')).toBe(true);
  expect(limited.files['environment/tile-reference.json']).toBeDefined();
  expect(limited.files['environment/tiles.json']).toBeUndefined();
  expect(verifyArchive(limited)).toMatchObject({ autonomous: false, mode: 'LIMITED_RESEARCH' });
  expect(verifyArchive(limited).limitations.join(' ')).toContain('лицензи');
});

it('список участников ограничен политикой экспорта', () => {
  const participants = filterParticipantsForExport([
    { userId: 'u1', displayName: 'Скрытое имя', role: 'COMMANDER', sideId: 'blue', passwordHash: 'secret' },
  ], { includeDisplayNames: false, allowedSideIds: ['blue'] });
  expect(participants).toEqual([{ userId: 'u1', role: 'COMMANDER', sideId: 'blue' }]);
  expect(JSON.stringify(participants)).not.toContain('secret');
});

function exportedWithOrgMismatch() {
  return exportArchive({
    actor, organizationId: 'org-2', archiveId: 'x', kind: 'OFFICIAL', createdAt: 'x', versions: archiveVersions,
    components: completeComponents(), policyAdapter: fullArchivePolicyAdapter, atlasLicense: { offlineExport: true, attribution: 'x' },
  });
}

it('не принимает формально целый архив с неполным журналом фактов за автономный', () => {
  const components = completeComponents();
  const replay = JSON.parse(components['replay.archive'].data as string) as ReplayArchive;
  replay.events = replay.events.slice(0, 1);
  replay.controlPoints = [];
  components['replay.archive'] = { data: JSON.stringify(replay) };
  const result = verifyArchive(makeArchiveBundle({ components }));
  expect(result.autonomous).toBe(false);
  expect(result.mode).toBe('LIMITED_RESEARCH');
  expect(result.missing).toContain('journal.facts:command.rejected');
  expect(result.missing).toContain('replay.control-points.empty');
});
