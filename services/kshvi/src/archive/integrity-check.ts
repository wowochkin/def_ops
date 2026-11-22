import {
  ARCHIVE_COMPONENTS,
  archiveManifestHash,
  sha256File,
  type ArchiveBundle,
} from '../../../../packages/kshvi/src/archive/archive-manifest';
import { ARCHIVE_COMPONENT_RULES, validateArchiveComponent } from '../../../../packages/kshvi/src/archive/component-schema';
import { validateArchivePaths, validateArchiveSchema } from '../../../../packages/kshvi/src/archive/archive-schema';
import {
  journalCoverage,
  restoreAt,
  REPLAY_DOMAINS,
  type ReplayArchive,
} from '../../../../packages/kshvi/src/replay/replay-engine';

export type ArchiveVerification = {
  valid: boolean;
  autonomous: boolean;
  mode: 'AUTONOMOUS' | 'LIMITED_RESEARCH' | 'REJECTED';
  missing: readonly string[];
  corrupted: readonly string[];
  brokenReferences: readonly string[];
  errors: readonly string[];
  limitations: readonly string[];
  manifestSha256: string;
};

export function verifyArchive(bundle: ArchiveBundle): ArchiveVerification {
  const { manifest, files } = bundle;
  const errors = validateArchiveSchema(manifest);
  const unsafe = validateArchivePaths(manifest);
  if (unsafe.length) errors.push(`Небезопасные пути: ${unsafe.join(', ')}`);
  const actualHash = archiveManifestHash(manifest);
  if (actualHash !== manifest.manifestSha256) errors.push('Контрольная сумма манифеста не совпадает');
  const omissions = new Map(manifest.omissions.map(item => [item.componentId, item]));
  const missing: string[] = [];
  const limitations = manifest.omissions.filter(item => !item.informational).map(item => item.reason);
  const requiredDefinitions = ARCHIVE_COMPONENTS.filter(component => component.required
    || (manifest.kind === 'EXPOSITION' && component.id.startsWith('exposition.')));
  const ids = new Set<string>();
  for (const definition of requiredDefinitions) {
    if (!ARCHIVE_COMPONENT_RULES[definition.id]) errors.push(`Отсутствует схема компонента ${definition.id}`);
    if (manifest.components.some(component => component.id === definition.id)) continue;
    if (omissions.get(definition.id)?.licenseLimitation) continue;
    missing.push(definition.id);
  }
  const corrupted: string[] = [];
  const brokenReferences: string[] = [];
  const manifestPaths = new Set<string>();
  for (const component of manifest.components) {
    if (ids.has(component.id)) errors.push(`Повтор компонента в манифесте: ${component.id}`);
    ids.add(component.id);
    if (manifestPaths.has(component.path)) errors.push(`Повтор пути в манифесте: ${component.path}`);
    manifestPaths.add(component.path);
  }
  for (const component of manifest.components) {
    const data = files[component.path];
    if (!data) {
      corrupted.push(component.path);
      continue;
    }
    if (component.bytes !== data.length || component.sha256 !== sha256File(data)) corrupted.push(component.path);
    missing.push(...validateArchiveComponent(component.id, data));
    for (const reference of component.references) {
      if (!manifestPaths.has(reference) || !files[reference]) brokenReferences.push(reference);
    }
  }
  for (const path of Object.keys(files)) if (!manifestPaths.has(path)) errors.push(`Файл отсутствует в манифесте: ${path}`);
  const replayEntry = manifest.components.find(component => component.id === 'replay.archive');
  const replayFile = replayEntry ? files[replayEntry.path] : undefined;
  if (replayFile) {
    try {
      const replay = JSON.parse(new TextDecoder().decode(replayFile)) as ReplayArchive;
      for (const factType of journalCoverage(replay.events)) missing.push(`journal.facts:${factType}`);
      for (const domain of REPLAY_DOMAINS) {
        if (replay.snapshots.some(snapshot => !(domain in snapshot.state.domains))) missing.push(`replay.domain:${domain}`);
      }
      if (!replay.controlPoints?.length) missing.push('replay.control-points.empty');
      else {
        for (const point of replay.controlPoints) {
          try {
            const branchId = point.branchId ?? replay.branchId;
            const frame = restoreAt({ archive: replay, cursor: { branchId, sequence: point.sequence } });
            if (!frame.identityClaimed || frame.stateHash !== point.stateHash) errors.push(`Контрольная точка не воспроизводится: ${branchId}/${point.sequence}`);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
    } catch (error) {
      errors.push(`Некорректный журнал реплея: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const rejected = corrupted.length > 0 || brokenReferences.length > 0 || errors.length > 0;
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
  };
}
