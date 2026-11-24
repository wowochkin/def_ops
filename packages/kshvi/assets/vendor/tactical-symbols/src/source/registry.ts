import registryData from '../../data/source-registry.json' with { type: 'json' };

export const SOURCE_ARCHIVE_SHA256 = '123731284d4fd3ed3c3963afe457f1cf3cdb34db500a38cdc33451ca2ddc6331';

export const REQUIRED_SOURCE_TOPICS = [
  'COMMAND_POSTS',
  'BOUNDARY_LINES',
  'MOVEMENT',
  'GROUND_FORCES',
  'AIR_FORCES',
  'NAVY',
  'STRATEGIC_MISSILE_FORCES',
  'RECONNAISSANCE',
  'SIGNALS',
  'ELECTRONIC_WARFARE',
  'CAMOUFLAGE',
  'ENGINEER_SUPPORT',
  'CBRN_PROTECTION',
  'TOPOGEODETIC_SUPPORT',
  'HYDROMETEOROLOGICAL_SUPPORT',
  'MORAL_PSYCHOLOGICAL_SUPPORT',
  'TECHNICAL_SUPPORT',
  'LOGISTICS_SUPPORT',
] as const;

export type RequiredSourceTopic = (typeof REQUIRED_SOURCE_TOPICS)[number];
export type SourceTopic = RequiredSourceTopic | 'SPACE_FORCES' | 'NUCLEAR_SUPPORT' | 'OTHER_ORGANIZATIONS';

export interface SourceDocumentRecord {
  readonly id: string;
  readonly originalName: string;
  readonly normalizedName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly topics: readonly SourceTopic[];
  readonly fragmentIds: readonly string[];
  readonly status: 'IMPORTED';
  readonly coverage: 'REGISTERED' | 'FRAGMENTS_EXTRACTED';
  readonly gaps: readonly string[];
}

export interface SourceFontRecord {
  readonly id: string;
  readonly originalName: string;
  readonly normalizedName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly runtimeRequired: false;
}

export interface SymbolSourceFragment {
  readonly id: string;
  readonly documentId: string;
  readonly sourceDocument: string;
  readonly page: number;
  readonly symbolNumber: string | null;
  readonly referenceFragment: Readonly<{
    format: 'JPEG';
    path: string;
    sha256: string;
  }>;
  readonly ruleText: string | null;
  readonly textScope: 'PAGE';
  readonly status: 'IMPORTED';
  readonly gaps: readonly string[];
}

export interface SourceRegistry {
  readonly schemaVersion: 1;
  readonly archive: Readonly<{
    fileName: 'TacticalSignsRussianForces.zip';
    sha256: typeof SOURCE_ARCHIVE_SHA256;
    documentCount: 29;
    fontCount: 2;
  }>;
  readonly documents: readonly SourceDocumentRecord[];
  readonly fonts: readonly SourceFontRecord[];
  readonly fragments: readonly SymbolSourceFragment[];
  readonly gaps: readonly string[];
}

export const sourceRegistry = registryData as SourceRegistry;

export function coverageReport(registry: SourceRegistry = sourceRegistry) {
  const coveredTopics = new Set(registry.documents.flatMap(document => document.topics));
  const documentIdsWithFragments = new Set(registry.fragments.map(fragment => fragment.documentId));
  const expectedNames = new Set([
    ...registry.documents.map(document => document.originalName),
    ...registry.fragments.map(fragment => fragment.sourceDocument),
  ]);
  const missingDocuments = [...expectedNames].filter(originalName => {
    const document = registry.documents.find(candidate => candidate.originalName === originalName);
    return !document || document.status !== 'IMPORTED' || document.coverage !== 'FRAGMENTS_EXTRACTED' || !documentIdsWithFragments.has(document.id);
  });
  const missingCount = Math.max(0, registry.archive.documentCount - registry.documents.length - missingDocuments.length);
  missingDocuments.push(...Array.from({ length: missingCount }, (_, index) => `Незарегистрированный документ ${index + 1}`));
  return {
    documents: registry.documents.length,
    fonts: registry.fonts.length,
    fragments: registry.fragments.length,
    documentsWithFragments: documentIdsWithFragments.size,
    missingDocuments,
    uncoveredTopics: REQUIRED_SOURCE_TOPICS.filter(topic => !coveredTopics.has(topic)),
    unmappedFragments: registry.fragments.filter(fragment => fragment.status === 'IMPORTED').length,
    status: registry.fragments.some(fragment => fragment.symbolNumber !== null) ? 'MAPPED_IN_PROGRESS' as const : 'PARTIAL' as const,
    gaps: registry.gaps,
  };
}
