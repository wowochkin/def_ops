import { expect, it } from 'vitest';
import { ARCHIVE_COMPONENTS } from '../../../packages/kshvi/src/archive/archive-components';
import { archiveVersions, completeComponents, makeArchiveBundle } from '../../../packages/kshvi/tests/fixtures/archive-fixture';
import { officialBranch } from '../../../packages/kshvi/tests/fixtures/branch-fixture';
import { verifyArchive } from '../src/archive/integrity-check';
import { verifyStandaloneArchive } from '../../../apps/archive-viewer/src/integrity';
import { importArchive } from '../src/archive/archive-importer';
import { exportArchive, serializeArchive } from '../src/archive/archive-exporter';
import { buildDebrief, publishDebrief } from '../../../packages/kshvi/src/assessment/debrief';
import { BranchService } from '../src/replay/branch-service';
import { ArchiveJobManager } from '../src/archive/archive-jobs';

const exportActor = { organizationId: 'org-1', userId: 'exporter', authorities: ['archive.export'] };
const importActor = { organizationId: 'org-1', userId: 'importer', authorities: ['archive.import', 'archive.publish'] };
const trustedBluePolicy = {
  allowedComponentIds: ARCHIVE_COMPONENTS.map(component => component.id),
  allowedSideIds: ['blue'], allowedAudiences: ['PUBLIC'], includeDisplayNames: false,
};
const blueAdapter = { policyFor: () => trustedBluePolicy };

function hiddenParticipants(asBytes = false) {
  const data = JSON.stringify({ schemaVersion: 1, payload: { assignments: [
    { userId: 'allowed', role: 'COMMANDER', sideId: 'blue', audience: ['PUBLIC'] },
    { userId: 'hidden-user', role: 'COMMANDER', sideId: 'red', audience: ['PUBLIC'], passwordHash: 'secret-hash' },
  ] } });
  return asBytes ? new TextEncoder().encode(data) : data;
}
function exportInput(components: ReturnType<typeof completeComponents>, adapter = blueAdapter) {
  return {
    actor: exportActor, organizationId: 'org-1', archiveId: 'rereview-export', kind: 'OFFICIAL' as const,
    createdAt: '2026-11-21T12:00:00.000Z', versions: archiveVersions, components, policyAdapter: adapter,
    atlasLicense: { offlineExport: true, attribution: 'Локальный атлас' },
  };
}

it('RR01: licenseLimitation+informational не скрывает пустой архив и всегда виден', () => {
  const omissions = ARCHIVE_COMPONENTS.filter(component => component.required).map(component => ({
    componentId: component.id, reason: `Ограничение ${component.id}`, licenseLimitation: true, informational: true,
  }));
  const bundle = makeArchiveBundle({ components: {}, omissions });
  const server = verifyArchive(bundle);
  const standalone = verifyStandaloneArchive(JSON.parse(serializeArchive(bundle)));
  expect(server.autonomous).toBe(false);
  expect(standalone.autonomous).toBe(false);
  expect(server.missing.length).toBeGreaterThan(0);
  expect(server.notices.length).toBeGreaterThan(0);
  expect(standalone.notices.length).toBeGreaterThan(0);
  expect(() => importArchive(serializeArchive(bundle), importActor)).toThrow('повреждён');
});

it('RR02: схемы массивов отклоняют null и пустые записи', () => {
  const components = completeComponents();
  components['environment.weather'] = { data: JSON.stringify({ schemaVersion: 1, payload: { frames: [null] } }) };
  components['snapshots.initial'] = { data: JSON.stringify({ schemaVersion: 1, payload: { snapshots: [{}] } }) };
  components['journal.events'] = { data: JSON.stringify({ schemaVersion: 1, payload: { events: [null] } }) };
  const result = verifyArchive(makeArchiveBundle({ components }));
  expect(result.autonomous).toBe(false);
  expect([...result.missing, ...result.errors].join('\n')).toContain('environment.weather');
  expect([...result.missing, ...result.errors].join('\n')).toContain('snapshots.initial');
  expect([...result.missing, ...result.errors].join('\n')).toContain('journal.events');
});

it('RR03: Uint8Array декодируется и фильтруется по side/audience/field', () => {
  const components = completeComponents();
  components['participants.assignments'] = { data: hiddenParticipants(true) };
  const bundle = exportArchive(exportInput(components));
  const participants = new TextDecoder().decode(bundle.files['participants/assignments.json']);
  expect(participants).toContain('allowed');
  expect(participants).not.toContain('hidden-user');
  expect(participants).not.toContain('secret-hash');
});

it('RR04: reference.content получает scope и не попадает из PRIVATE в PUBLIC', () => {
  const debrief = buildDebrief({
    scope: 'PRIVATE', instanceId: 'hq-1', trainingQuestions: ['q1'], audience: 'PRIVATE', allowedSideIds: ['blue'], materials: [], deviations: [],
    referenceIntent: { instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['q1'], audience: ['PRIVATE'], content: { text: 'PRIVATE-INTENT-SECRET' } },
  });
  const published = publishDebrief(debrief, { revision: 1, audience: ['PUBLIC'], publishedBy: 'leader', publishedAt: '2026-11-21T12:00:00Z' });
  expect(JSON.stringify(published)).not.toContain('PRIVATE-INTENT-SECRET');
  expect(published.reference.content).toMatchObject({ status: 'UNKNOWN' });
});

it('RR05: standalone использует серверную journalCoverage/22 domains/controlPoints проверку', () => {
  const components = completeComponents();
  const replay = JSON.parse(components['replay.archive'].data as string);
  replay.events = replay.events.slice(0, 1);
  replay.controlPoints = [];
  components['replay.archive'] = { data: JSON.stringify(replay) };
  const result = verifyStandaloneArchive(JSON.parse(serializeArchive(makeArchiveBundle({ components }))));
  expect(result).toMatchObject({ mode: 'LIMITED_RESEARCH', autonomous: false });
  expect(result.missing).toContain('journal.facts:command.rejected');
  expect(result.missing).toContain('replay.control-points.empty');
});

it('RR06: политика вычисляется адаптером назначений и не расширяется входным allowed*', () => {
  const components = completeComponents();
  components['participants.assignments'] = { data: hiddenParticipants() };
  const bundle = exportArchive(exportInput(components));
  const participants = new TextDecoder().decode(bundle.files['participants/assignments.json']);
  expect(participants).toContain('allowed');
  expect(participants).not.toContain('hidden-user');
});

it('RR09: повторный branchId не перезаписывает чужую ветвь', () => {
  const service = new BranchService(officialBranch());
  const leader = { organizationId: 'org-1', userId: 'leader-1', role: 'LEADER', authorities: ['OFFICIAL_READ', 'BRANCH_CREATE', 'BRANCH_READ', 'BRANCH_WRITE'] };
  const other = { ...leader, userId: 'other' };
  service.createBranch('owned-branch', leader);
  expect(() => service.createBranch('owned-branch', other)).toThrow('уже существует');
  expect(service.branch('owned-branch', leader).ownerId).toBe('leader-1');
});

it('RR10: idempotent submit требует read для возврата результата', async () => {
  const manager = new ArchiveJobManager();
  const owner = { organizationId: 'org-1', userId: 'owner', authorities: ['archive.jobs.create', 'archive.jobs.read', 'archive.jobs.cancel'] };
  const job = manager.submit({ idempotencyKey: 'read-result', kind: 'EXPORT', payload: {}, owner, run: () => ({ secret: 'job-result' }) });
  manager.start();
  await manager.wait(job.id);
  expect(() => manager.submit({ idempotencyKey: 'read-result', kind: 'EXPORT', payload: {}, owner: { ...owner, authorities: ['archive.jobs.create'] }, run: () => ({ secret: 'job-result' }) })).toThrow('403');
});
