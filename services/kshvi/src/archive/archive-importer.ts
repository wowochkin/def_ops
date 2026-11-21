import type { ArchiveBundle } from '../../../../packages/kshvi/src/archive/archive-manifest';
import { deserializeArchive } from './archive-exporter';
import { verifyArchive, type ArchiveVerification } from './integrity-check';

export type ArchiveImportResult = {
  archive: ArchiveBundle;
  verification: ArchiveVerification;
  mode: 'AUTONOMOUS' | 'LIMITED_RESEARCH';
  publicationEligible: boolean;
};

export function importArchive(serialized: string): ArchiveImportResult {
  const archive = deserializeArchive(serialized);
  const verification = verifyArchive(archive);
  if (verification.mode === 'REJECTED') throw new Error(`Архив повреждён или несовместим: ${[...verification.errors, ...verification.corrupted, ...verification.brokenReferences].join('; ')}`);
  return {
    archive,
    verification,
    mode: verification.autonomous ? 'AUTONOMOUS' : 'LIMITED_RESEARCH',
    publicationEligible: verification.autonomous,
  };
}
