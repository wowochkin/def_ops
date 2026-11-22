import { ARCHIVE_COMPONENTS } from '../../../packages/kshvi/src/archive/archive-components';
import { validateArchiveComponent } from '../../../packages/kshvi/src/archive/component-schema';
import type { ArchiveManifest } from '../../../packages/kshvi/src/archive/archive-manifest';
import { canonicalOfflineJson, sha256Offline } from './replay';

export type StandaloneArchivePackage = {
  manifest: ArchiveManifest;
  files: Record<string, string>;
};
export type StandaloneVerification = {
  valid: boolean;
  autonomous: boolean;
  mode: 'AUTONOMOUS' | 'LIMITED_RESEARCH' | 'REJECTED';
  missing: readonly string[];
  corrupted: readonly string[];
  brokenReferences: readonly string[];
  errors: readonly string[];
  limitations: readonly string[];
  manifestSha256: string;
  replayPath: string | null;
};

export function standaloneBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export function standaloneText(base64: string): string {
  return new TextDecoder().decode(standaloneBytes(base64));
}
function manifestHash(manifest: ArchiveManifest): string {
  const { manifestSha256: ignored, ...content } = manifest;
  void ignored;
  return sha256Offline(new TextEncoder().encode(canonicalOfflineJson(content)));
}

export function verifyStandaloneArchive(packageData: StandaloneArchivePackage): StandaloneVerification {
  const { manifest, files } = packageData;
  const errors: string[] = [];
  const missing: string[] = [];
  const corrupted: string[] = [];
  const brokenReferences: string[] = [];
  if (manifest.schemaVersion !== 1) errors.push('Неподдерживаемая версия схемы архива');
  const actualHash = manifestHash(manifest);
  if (actualHash !== manifest.manifestSha256) errors.push('Контрольная сумма манифеста не совпадает');
  const omissions = new Map(manifest.omissions.map(item => [item.componentId, item]));
  const required = ARCHIVE_COMPONENTS.filter(component => component.required
    || (manifest.kind === 'EXPOSITION' && component.id.startsWith('exposition.')));
  for (const definition of required) {
    if (manifest.components.some(component => component.id === definition.id)) continue;
    if (omissions.get(definition.id)?.licenseLimitation) continue;
    missing.push(definition.id);
  }
  const paths = new Set(manifest.components.map(component => component.path));
  for (const component of manifest.components) {
    if (!component.path || component.path.startsWith('/') || component.path.split('/').includes('..')) errors.push(`Небезопасный путь: ${component.path}`);
    let bytes: Uint8Array;
    try {
      const encoded = files[component.path];
      if (typeof encoded !== 'string') throw new Error('Файл отсутствует');
      bytes = standaloneBytes(encoded);
    } catch {
      corrupted.push(component.path);
      continue;
    }
    if (bytes.length !== component.bytes || sha256Offline(bytes) !== component.sha256) corrupted.push(component.path);
    missing.push(...validateArchiveComponent(component.id, bytes));
    for (const reference of component.references) if (!paths.has(reference) || typeof files[reference] !== 'string') brokenReferences.push(reference);
  }
  for (const path of Object.keys(files)) if (!paths.has(path)) errors.push(`Файл отсутствует в манифесте: ${path}`);
  const limitations = manifest.omissions.filter(item => !item.informational).map(item => item.reason);
  const rejected = errors.length > 0 || corrupted.length > 0 || brokenReferences.length > 0;
  const autonomous = !rejected && missing.length === 0 && limitations.length === 0;
  return {
    valid: !rejected && missing.length === 0,
    autonomous,
    mode: rejected ? 'REJECTED' : autonomous ? 'AUTONOMOUS' : 'LIMITED_RESEARCH',
    missing: [...new Set(missing)],
    corrupted: [...new Set(corrupted)],
    brokenReferences: [...new Set(brokenReferences)],
    errors,
    limitations,
    manifestSha256: actualHash,
    replayPath: manifest.components.find(component => component.id === 'replay.archive')?.path ?? null,
  };
}
