import {
  ARCHIVE_COMPONENTS,
  createArchiveManifest,
  materializeArchiveFiles,
  type ArchiveBundle,
  type ArchiveComponentInput,
  type ArchiveManifestInput,
} from '../../src/archive/archive-manifest';
import { makeReplayArchive } from './replay-archive';

export const archiveVersions = {
  model: { id: 'model', revision: 1, sha256: 'a'.repeat(64) },
  environment: { id: 'environment', revision: 1, sha256: 'b'.repeat(64) },
  reducerVersion: 1,
};

export function completeComponents(includeExposition = false): Record<string, ArchiveComponentInput> {
  const entries = ARCHIVE_COMPONENTS.filter(component => includeExposition || !component.id.startsWith('exposition.'));
  return Object.fromEntries(entries.map(component => {
    let data: string | Uint8Array = JSON.stringify({ componentId: component.id, recorded: true });
    if (component.id === 'replay.archive') data = JSON.stringify(makeReplayArchive());
    if (component.id === 'environment.attribution') data = JSON.stringify({ attribution: 'Локальный атлас', license: 'OFFLINE_EXPORT_ALLOWED' });
    if (component.id === 'journal.hash-chain') return [component.id, { data, references: ['journal/events.json'] }];
    if (component.id === 'replay.control-points') return [component.id, { data, references: ['snapshots/final.json'] }];
    return [component.id, { data }];
  }));
}

export function manifestInput(overrides: Partial<ArchiveManifestInput> = {}): ArchiveManifestInput {
  return {
    archiveId: 'archive-official-1', kind: 'OFFICIAL', organizationId: 'org-1', createdAt: '2026-11-21T12:00:00.000Z',
    versions: archiveVersions, components: completeComponents(), ...overrides,
  };
}

export function makeArchiveBundle(overrides: Partial<ArchiveManifestInput> = {}): ArchiveBundle {
  const input = manifestInput(overrides);
  return { manifest: createArchiveManifest(input), files: materializeArchiveFiles(input.components) };
}
