import { expect, it } from 'vitest';
import { ARCHIVE_COMPONENTS } from '../../../packages/kshvi/src/archive/archive-manifest';
import type { ReplayArchive } from '../../../packages/kshvi/src/replay/types';
import {
  archiveVersions,
  completeComponents,
  makeArchiveBundle,
  manifestInput,
} from '../../../packages/kshvi/tests/fixtures/archive-fixture';
import { makeReplayArchive } from '../../../packages/kshvi/tests/fixtures/replay-archive';
import { exportArchive, serializeArchive } from '../src/archive/archive-exporter';
import { importArchive } from '../src/archive/archive-importer';
import { verifyArchive } from '../src/archive/integrity-check';
import { buildOfflineViewer } from '../src/archive/offline-viewer-builder';

const actor = { organizationId: 'org-1', userId: 'exporter-1', authorities: ['archive.export'] };
const exportPolicy = {
  allowedComponentIds: ARCHIVE_COMPONENTS.map(component => component.id),
  allowedSideIds: ['blue', 'red'],
  allowedAudiences: ['GENERAL', 'PRIVATE', 'PUBLIC', 'commanders'],
  includeDisplayNames: false,
};

function exportInput(components = completeComponents()) {
  return {
    actor, organizationId: 'org-1', archiveId: 'review-archive', kind: 'OFFICIAL' as const,
    createdAt: '2026-11-21T12:00:00.000Z', versions: archiveVersions, components, exportPolicy,
    atlasLicense: { offlineExport: true, attribution: 'Локальный атлас' },
  };
}

it('R01: каждый обязательный компонент отклоняет семантически пустое содержимое и его обходы', () => {
  const components = completeComponents();
  for (const definition of ARCHIVE_COMPONENTS.filter(component => component.required)) {
    components[definition.id] = { ...components[definition.id], data: 'null' };
  }
  const result = verifyArchive(makeArchiveBundle({ components }));
  expect(result.autonomous).toBe(false);
  const findings = [...result.missing, ...result.errors].join('\n');
  for (const definition of ARCHIVE_COMPONENTS.filter(component => component.required)) {
    expect(findings, definition.id).toContain(definition.id);
  }

  const emptyObjects = completeComponents();
  emptyObjects['environment.weather'] = { data: '{}' };
  emptyObjects['documents.revisions'] = { data: '{"schemaVersion":1,"revisions":null}' };
  const bypass = verifyArchive(makeArchiveBundle({ components: emptyObjects }));
  expect(bypass.autonomous).toBe(false);
  expect([...bypass.missing, ...bypass.errors].join('\n')).toContain('environment.weather');
  expect([...bypass.missing, ...bypass.errors].join('\n')).toContain('documents.revisions');
});

it('R02: журнал проверяется по пути из манифеста, включая alternate.json', () => {
  const components = completeComponents();
  const emptyReplay: ReplayArchive = { ...makeReplayArchive(), events: [], snapshots: [], controlPoints: [] };
  components['replay.archive'] = { path: 'alternate.json', data: JSON.stringify(emptyReplay) };
  const result = verifyArchive(makeArchiveBundle({ components }));
  expect(result.autonomous).toBe(false);
  expect(result.missing).toContain('journal.facts:command.rejected');
  expect(result.missing).toContain('replay.control-points.empty');
});

it('R03: импорт и публикация требуют actor, организацию и отдельные права', () => {
  const serialized = serializeArchive(makeArchiveBundle());
  expect(() => importArchive(serialized, { organizationId: 'org-1', userId: 'u1', authorities: [] })).toThrow('403');
  expect(() => importArchive(serialized, { organizationId: 'org-2', userId: 'u1', authorities: ['archive.import', 'archive.publish'] })).toThrow('403');
  const research = importArchive(serialized, { organizationId: 'org-1', userId: 'u1', authorities: ['archive.import'] });
  expect(research.publicationEligible).toBe(false);
  const publisher = importArchive(serialized, { organizationId: 'org-1', userId: 'u1', authorities: ['archive.import', 'archive.publish'] });
  expect(publisher.publicationEligible).toBe(true);
});

it('R04: экспорт применяет серверную проекцию компонентов, сторон и полей участников', () => {
  const components = completeComponents();
  components['participants.assignments'] = {
    data: JSON.stringify({ schemaVersion: 1, payload: { assignments: [
      { userId: 'allowed', displayName: 'Разрешённое имя', role: 'COMMANDER', sideId: 'blue', passwordHash: 'secret-hash', note: 'hidden-note' },
      { userId: 'hidden-user', displayName: 'Скрытое имя', role: 'COMMANDER', sideId: 'red', passwordHash: 'other-secret' },
    ] } }),
  };
  components['documents.revisions'] = {
    data: JSON.stringify({ schemaVersion: 1, payload: { revisions: [
      { id: 'public-doc', sideId: 'blue', audience: ['PUBLIC'], text: 'Разрешённый документ' },
      { id: 'hidden-doc', sideId: 'red', audience: ['PRIVATE'], text: 'Скрытый замысел' },
    ] } }),
  };
  const bundle = exportArchive({
    ...exportInput(components),
    exportPolicy: { ...exportPolicy, allowedSideIds: ['blue'], allowedAudiences: ['PUBLIC'], allowedComponentIds: exportPolicy.allowedComponentIds.filter(id => id !== 'environment.weather') },
  });
  const participants = new TextDecoder().decode(bundle.files['participants/assignments.json']);
  const documents = new TextDecoder().decode(bundle.files['documents/revisions.json']);
  expect(participants).toContain('allowed');
  expect(participants).not.toContain('hidden-user');
  expect(participants).not.toContain('secret-hash');
  expect(participants).not.toContain('hidden-note');
  expect(participants).not.toContain('Скрытое имя');
  expect(documents).toContain('public-doc');
  expect(documents).not.toContain('Скрытый замысел');
  expect(verifyArchive(bundle).missing).toContain('environment.weather');
});

it('R08: standalone HTML экранирует архив и ограничения и запрещает сетевые подключения CSP', () => {
  const bundle = makeArchiveBundle(manifestInput({
    archiveId: '<script>globalThis.__archiveXss=1</script>',
    omissions: [{ componentId: 'environment.weather', reason: '<img src=x onerror=globalThis.__archiveXss=1>' }],
  }));
  const html = buildOfflineViewer(bundle);
  expect(html).not.toContain('<script>globalThis.__archiveXss=1</script>');
  expect(html).not.toContain('<img src=x onerror=globalThis.__archiveXss=1>');
  expect(html).toContain('&lt;script&gt;globalThis.__archiveXss=1&lt;/script&gt;');
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("object-src 'none'");
});
