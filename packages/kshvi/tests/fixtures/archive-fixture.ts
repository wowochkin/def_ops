import {
  ARCHIVE_COMPONENTS,
  createArchiveManifest,
  materializeArchiveFiles,
  type ArchiveBundle,
  type ArchiveComponentInput,
  type ArchiveManifestInput,
} from '../../src/archive/archive-manifest';
import { ARCHIVE_COMPONENT_RULES, type ArchiveFieldType } from '../../src/archive/component-schema';
import { makeReplayArchive } from './replay-archive';

export const archiveVersions = {
  model: { id: 'model', revision: 1, sha256: 'a'.repeat(64) },
  environment: { id: 'environment', revision: 1, sha256: 'b'.repeat(64) },
  reducerVersion: 1,
};
export const fullArchiveExportPolicy = {
  allowedComponentIds: ARCHIVE_COMPONENTS.map(component => component.id),
  allowedSideIds: ['blue', 'red'],
  allowedAudiences: ['GENERAL', 'PRIVATE', 'PUBLIC', 'commanders'],
  includeDisplayNames: false,
};

function sampleValue(componentId: string, path: string, type: ArchiveFieldType, filled: boolean): unknown {
  if (type === 'array') return filled ? [{
    id: 'item-1', eventId: 'event-1', type: 'recorded', sequence: 1, revision: 1,
    state: { recorded: true }, stateHash: 'a'.repeat(64), hash: 'a'.repeat(64), operationalAt: '2026-11-21T00:00:00.000Z',
    userId: 'user-1', role: 'COMMANDER', sideId: 'blue', audience: ['GENERAL', 'PRIVATE', 'PUBLIC', 'commanders'], data: 'recorded', sha256: 'a'.repeat(64),
  }] : [];
  if (type === 'object') return filled ? { recorded: true } : {};
  if (type === 'number') return 1;
  if (type === 'boolean') return true;
  return `${componentId}.${path}`;
}
function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = target;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[keys.at(-1)!] = value;
}
function validComponentData(componentId: string): string {
  if (componentId === 'replay.archive') return JSON.stringify(makeReplayArchive());
  const rule = ARCHIVE_COMPONENT_RULES[componentId];
  if (rule.format === 'text') return 'function recordedReplayAt(state) { return state; }';
  if (rule.format === 'html') return '<!doctype html><html><body><script id="archive-package" type="application/json">{}</script></body></html>';
  const root: Record<string, unknown> = { schemaVersion: 1, payload: {} };
  for (const [path, type] of Object.entries(rule.fields ?? {})) {
    assignPath(root, path, sampleValue(componentId, path, type, rule.nonEmpty?.includes(path) ?? false));
  }
  return JSON.stringify(root);
}

export function completeComponents(includeExposition = false): Record<string, ArchiveComponentInput> {
  const entries = ARCHIVE_COMPONENTS.filter(component => includeExposition || !component.id.startsWith('exposition.'));
  return Object.fromEntries(entries.map(component => {
    const data = validComponentData(component.id);
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
