import type { ArchiveManifest } from './archive-manifest';

export const SUPPORTED_ARCHIVE_SCHEMA_VERSIONS = [1] as const;

export function validateArchiveSchema(manifest: ArchiveManifest): string[] {
  return SUPPORTED_ARCHIVE_SCHEMA_VERSIONS.includes(manifest.schemaVersion as 1)
    ? []
    : ['Неподдерживаемая версия схемы архива'];
}

export function validateArchivePaths(manifest: ArchiveManifest): string[] {
  return manifest.components.filter(component => {
    const path = component.path;
    return !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || /^[a-z]:/i.test(path);
  }).map(component => component.id);
}
