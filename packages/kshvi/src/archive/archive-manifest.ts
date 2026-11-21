import { sha256Canonical, sha256File } from './file-digest';
import type { ReplayVersionRef } from '../replay/types';

export { sha256File } from './file-digest';

export type ArchiveComponentDefinition = { id: string; path: string; required: boolean };
const required = (id: string, path: string): ArchiveComponentDefinition => ({ id, path, required: true });
const optional = (id: string, path: string): ArchiveComponentDefinition => ({ id, path, required: false });

export const ARCHIVE_COMPONENTS: readonly ArchiveComponentDefinition[] = [
  required('exercise.card', 'exercise/card.json'),
  required('scenario.revisions', 'scenario/revisions.json'),
  required('assumptions.passport', 'scenario/assumptions.json'),
  required('snapshots.initial', 'snapshots/initial.json'),
  required('snapshots.intermediate', 'snapshots/intermediate.json'),
  required('snapshots.final', 'snapshots/final.json'),
  required('journal.events', 'journal/events.json'),
  required('journal.hash-chain', 'journal/hash-chain.json'),
  required('replay.archive', 'replay/archive.json'),
  required('replay.control-points', 'replay/control-points.json'),
  required('environment.map', 'environment/map.json'),
  required('environment.initial', 'environment/initial.json'),
  required('environment.tiles', 'environment/tiles.json'),
  required('environment.elevations', 'environment/elevations.json'),
  required('environment.weather', 'environment/weather.json'),
  required('environment.terrain-initial', 'environment/terrain-initial.json'),
  required('environment.terrain-history', 'environment/terrain-history.json'),
  required('environment.attribution', 'environment/attribution.json'),
  optional('environment.tile-reference', 'environment/tile-reference.json'),
  required('forces.structure', 'forces/structure.json'),
  required('forces.equipment', 'forces/equipment.json'),
  required('forces.morale-psych', 'forces/morale-psych.json'),
  required('forces.readiness', 'forces/readiness.json'),
  required('forces.readiness-activities', 'forces/readiness-activities.json'),
  required('forces.formation', 'forces/formation.json'),
  required('logistics.resources', 'logistics/resources.json'),
  required('logistics.depots', 'logistics/depots.json'),
  required('logistics.supply-requests', 'logistics/supply-requests.json'),
  required('logistics.supply-movements', 'logistics/supply-movements.json'),
  required('logistics.repair-evacuation', 'logistics/repair-evacuation.json'),
  required('communications.queue', 'communications/queue.json'),
  required('communications.attempts', 'communications/attempts.json'),
  required('documents.revisions', 'documents/revisions.json'),
  required('documents.printed-forms', 'documents/printed-forms.json'),
  required('event-catalog.versions', 'event-catalog/versions.json'),
  required('event-catalog.intensity', 'event-catalog/intensity.json'),
  required('scheduler.candidates', 'scheduler/candidates.json'),
  required('scheduler.random-keys', 'scheduler/random-keys.json'),
  required('agents.assignments', 'agents/assignments.json'),
  required('agents.profiles', 'agents/profiles.json'),
  required('agents.decision-traces', 'agents/decision-traces.json'),
  required('agents.variant-runs', 'agents/variant-runs.json'),
  required('symbols.set', 'symbols/set.json'),
  required('symbols.vector-definitions', 'symbols/vector-definitions.json'),
  required('symbols.sources', 'symbols/sources.json'),
  required('symbols.render-rules', 'symbols/render-rules.json'),
  required('symbols.legends', 'symbols/legends.json'),
  required('decisions.records', 'decisions/records.json'),
  required('calculations.records', 'calculations/records.json'),
  required('models.versions', 'models/versions.json'),
  required('models.algorithm-versions', 'models/algorithm-versions.json'),
  required('references.modern', 'references/modern.json'),
  required('assessments.sheets', 'assessments/sheets.json'),
  required('debriefs.materials', 'debriefs/materials.json'),
  required('research.cards', 'research/cards.json'),
  required('branches.comparisons', 'branches/comparisons.json'),
  required('participants.assignments', 'participants/assignments.json'),
  required('viewer.engine', 'viewer/engine.js'),
  required('viewer.resources', 'viewer/resources.json'),
  required('viewer.index', 'viewer/index.html'),
  optional('exposition.program', 'exposition/program.json'),
  optional('exposition.explanations', 'exposition/explanations.json'),
  optional('exposition.audience-policy', 'exposition/audience-policy.json'),
];

export type ArchiveComponentInput = {
  data: Uint8Array | string;
  path?: string;
  required?: boolean;
  mediaType?: string;
  references?: readonly string[];
};
export type ArchiveOmission = { componentId: string; reason: string; licenseLimitation?: boolean };
export type ArchiveManifestInput = {
  archiveId: string;
  kind: 'OFFICIAL' | 'EXPOSITION';
  originArchiveId?: string;
  organizationId: string;
  createdAt: string;
  schemaVersion?: number;
  versions: { model: ReplayVersionRef; environment: ReplayVersionRef; reducerVersion: number };
  components: Record<string, ArchiveComponentInput>;
  omissions?: readonly ArchiveOmission[];
};
export type ArchiveFileEntry = {
  id: string;
  path: string;
  required: boolean;
  sha256: string;
  bytes: number;
  mediaType: string;
  references: readonly string[];
};
export type ArchiveManifest = {
  schemaVersion: number;
  archiveId: string;
  kind: 'OFFICIAL' | 'EXPOSITION';
  originArchiveId?: string;
  organizationId: string;
  createdAt: string;
  versions: ArchiveManifestInput['versions'];
  components: ArchiveFileEntry[];
  omissions: readonly ArchiveOmission[];
  manifestSha256: string;
};
export type ArchiveBundle = { manifest: ArchiveManifest; files: Record<string, Uint8Array> };

function bytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
}
function mediaType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/json';
}

export function createArchiveManifest(input: ArchiveManifestInput): ArchiveManifest {
  if (!input.archiveId.trim() || !input.organizationId.trim()) throw new Error('Архиву нужны идентификатор и организация');
  if (input.kind === 'EXPOSITION' && (!input.originArchiveId || input.originArchiveId === input.archiveId)) {
    throw new Error('Пакету показа нужен другой идентификатор и связь с официальным архивом');
  }
  const definitions = new Map(ARCHIVE_COMPONENTS.map(component => [component.id, component]));
  const components = Object.entries(input.components).map(([id, component]) => {
    const definition = definitions.get(id);
    if (!definition) throw new Error(`Неизвестный компонент архива: ${id}`);
    const path = component.path ?? definition.path;
    const content = bytes(component.data);
    return {
      id, path,
      required: component.required ?? (input.kind === 'EXPOSITION' && id.startsWith('exposition.') ? true : definition.required),
      sha256: sha256File(content), bytes: content.length,
      mediaType: component.mediaType ?? mediaType(path), references: [...(component.references ?? [])],
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const manifest: ArchiveManifest = {
    schemaVersion: input.schemaVersion ?? 1,
    archiveId: input.archiveId,
    kind: input.kind,
    ...(input.originArchiveId ? { originArchiveId: input.originArchiveId } : {}),
    organizationId: input.organizationId,
    createdAt: input.createdAt,
    versions: structuredClone(input.versions),
    components,
    omissions: structuredClone(input.omissions ?? []),
    manifestSha256: '',
  };
  manifest.manifestSha256 = archiveManifestHash(manifest);
  return manifest;
}

export function archiveManifestHash(manifest: ArchiveManifest): string {
  const { manifestSha256: ignored, ...content } = manifest;
  void ignored;
  return sha256Canonical(content);
}

export function materializeArchiveFiles(components: Record<string, ArchiveComponentInput>): Record<string, Uint8Array> {
  const definitions = new Map(ARCHIVE_COMPONENTS.map(component => [component.id, component]));
  const files: Record<string, Uint8Array> = {};
  for (const [id, component] of Object.entries(components)) {
    const definition = definitions.get(id);
    if (!definition) throw new Error(`Неизвестный компонент архива: ${id}`);
    const path = component.path ?? definition.path;
    if (files[path]) throw new Error(`Повторный путь архива: ${path}`);
    files[path] = bytes(component.data);
  }
  return files;
}
