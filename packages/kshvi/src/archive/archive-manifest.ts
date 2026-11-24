import { sha256Canonical, sha256File } from './file-digest';
import { ARCHIVE_COMPONENTS } from './archive-components';
import type { ReplayVersionRef } from '../replay/types';

export { sha256File } from './file-digest';
export { ARCHIVE_COMPONENTS } from './archive-components';
export type { ArchiveComponentDefinition } from './archive-components';

export type ArchiveComponentInput = {
  data: Uint8Array | string;
  path?: string;
  required?: boolean;
  mediaType?: string;
  references?: readonly string[];
};
export type ArchiveOmission = { componentId: string; reason: string; licenseLimitation?: boolean; informational?: boolean };
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
