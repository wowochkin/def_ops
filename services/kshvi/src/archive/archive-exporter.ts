import {
  createArchiveManifest,
  materializeArchiveFiles,
  type ArchiveBundle,
  type ArchiveComponentInput,
  type ArchiveManifestInput,
} from '../../../../packages/kshvi/src/archive/archive-manifest';
import { projectComponentForExport, type ParticipantExportPolicy } from './retention-export';

export type ArchiveExportActor = { organizationId: string; userId: string; authorities: readonly string[] };
export type ArchiveExportPolicy = ParticipantExportPolicy & { allowedComponentIds: readonly string[] };
export type ArchiveExportInput = ArchiveManifestInput & {
  actor: ArchiveExportActor;
  exportPolicy: ArchiveExportPolicy;
  atlasLicense: { offlineExport: boolean; attribution: string; reference?: unknown };
  allowReferenceOnly?: boolean;
};

export function exportArchive(input: ArchiveExportInput): ArchiveBundle {
  if (!input.actor.userId || !input.actor.authorities.includes('archive.export') || input.actor.organizationId !== input.organizationId) {
    throw new Error('403: Экспорт архива недоступен');
  }
  const omissions = [...(input.omissions ?? [])];
  const allowed = new Set(input.exportPolicy.allowedComponentIds);
  const components: Record<string, ArchiveComponentInput> = {};
  for (const [componentId, component] of Object.entries(input.components)) {
    if (allowed.has(componentId)) components[componentId] = structuredClone(component);
    else omissions.push({ componentId, reason: 'Компонент исключён серверной политикой экспорта' });
  }
  if (!input.atlasLicense.offlineExport) {
    if (!input.allowReferenceOnly) throw new Error('Лицензия атласа запрещает автономную выгрузку тайлов');
    delete components['environment.tiles'];
    components['environment.tile-reference'] = {
      data: JSON.stringify({ schemaVersion: 1, payload: { reference: input.atlasLicense.reference ?? { style: 'sealed' }, attribution: input.atlasLicense.attribution } }),
    };
    omissions.push({ componentId: 'environment.tiles', reason: 'лицензия разрешает только экспорт ссылки/стиля; полностью автономное воспроизведение невозможно', licenseLimitation: true });
  }
  for (const [componentId, component] of Object.entries(components)) {
    try {
      const projected = projectComponentForExport(componentId, component.data, input.exportPolicy);
      component.data = projected.data;
      if (projected.redacted) omissions.push({ componentId, reason: 'Применена серверная проекция разрешённых данных', informational: true });
    } catch (error) {
      throw new Error(`Некорректные данные компонента ${componentId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const manifestInput: ArchiveManifestInput = {
    archiveId: input.archiveId, kind: input.kind, ...(input.originArchiveId ? { originArchiveId: input.originArchiveId } : {}),
    organizationId: input.organizationId, createdAt: input.createdAt, schemaVersion: input.schemaVersion,
    versions: input.versions, components, omissions,
  };
  return { manifest: createArchiveManifest(manifestInput), files: materializeArchiveFiles(components) };
}

export function serializeArchive(bundle: ArchiveBundle): string {
  return JSON.stringify({
    manifest: bundle.manifest,
    files: Object.fromEntries(Object.entries(bundle.files).map(([path, data]) => [path, Buffer.from(data).toString('base64')])),
  });
}

export function deserializeArchive(serialized: string): ArchiveBundle {
  const parsed = JSON.parse(serialized) as { manifest?: ArchiveBundle['manifest']; files?: Record<string, string> };
  if (!parsed.manifest || !parsed.files || typeof parsed.files !== 'object') throw new Error('Некорректная структура архивного пакета');
  return {
    manifest: parsed.manifest,
    files: Object.fromEntries(Object.entries(parsed.files).map(([path, data]) => [path, new Uint8Array(Buffer.from(data, 'base64'))])),
  };
}
