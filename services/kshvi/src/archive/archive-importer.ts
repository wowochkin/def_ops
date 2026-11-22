import type { ArchiveBundle } from '../../../../packages/kshvi/src/archive/archive-manifest';
import { deserializeArchive } from './archive-exporter';
import { verifyArchive, type ArchiveVerification } from './integrity-check';

export type ArchiveImportActor = {
  organizationId: string;
  userId: string;
  authorities: readonly string[];
};
export type ArchiveImportResult = {
  archive: ArchiveBundle;
  verification: ArchiveVerification;
  mode: 'AUTONOMOUS' | 'LIMITED_RESEARCH';
  publicationEligible: boolean;
};

export function importArchive(serialized: string, actor: ArchiveImportActor): ArchiveImportResult {
  if (!actor.userId || !actor.authorities.includes('archive.import')) throw new Error('403: Импорт архива недоступен');
  const archive = deserializeArchive(serialized);
  if (archive.manifest.organizationId !== actor.organizationId) throw new Error('403: Архив другой организации недоступен');
  const verification = verifyArchive(archive);
  if (verification.mode === 'REJECTED') throw new Error(`Архив повреждён или несовместим: ${[...verification.errors, ...verification.corrupted, ...verification.brokenReferences].join('; ')}`);
  return {
    archive,
    verification,
    mode: verification.autonomous ? 'AUTONOMOUS' : 'LIMITED_RESEARCH',
    publicationEligible: verification.autonomous && actor.authorities.includes('archive.publish'),
  };
}
