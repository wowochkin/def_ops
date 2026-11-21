import type { DocumentRevision } from './document';

export type DocumentExportContext = Readonly<{
  exerciseTitle: string;
  exerciseRevision: number;
  exportedAt: string;
}>;

export type DocumentExportBlock = Readonly<{
  kind: 'TITLE' | 'REQUISITES' | 'BODY' | 'LEGEND' | 'ATTRIBUTION' | 'SOURCE';
  text: string;
}>;

export type DocumentExportModel = Readonly<{
  schemaVersion: 1;
  source: Readonly<{ documentId: string; revision: number; sha256: string; templateVersion: string }>;
  exercise: Readonly<{ title: string; revision: number }>;
  exportedAt: string;
  document: Readonly<{
    title: string;
    number: string;
    operationalAt: string;
    place: string;
    units: Readonly<Record<string, string>>;
  }>;
  environmentSnapshotId: string | null;
  legend: readonly string[];
  attribution: readonly string[];
  contentBlocks: readonly DocumentExportBlock[];
  pageNumbering: 'decimal';
}>;

export function createDocumentExportModel(revision: DocumentRevision, context: DocumentExportContext): DocumentExportModel {
  if (!context.exerciseTitle.trim() || !Number.isSafeInteger(context.exerciseRevision) || context.exerciseRevision < 1) {
    throw new Error('Экспорт требует название и неизменяемую редакцию учения');
  }
  if (!Number.isFinite(Date.parse(context.exportedAt))) throw new Error('Некорректные метаданные времени экспорта');
  const { requisites } = revision;
  const legend = revision.map?.legend ?? [];
  const attribution = revision.map?.attribution ?? [];
  const units = Object.entries(revision.content.units);
  const contentBlocks: DocumentExportBlock[] = [
    { kind: 'TITLE', text: requisites.title },
    { kind: 'REQUISITES', text: `Учение: ${context.exerciseTitle}; редакция учения: ${context.exerciseRevision}` },
    { kind: 'REQUISITES', text: `Документ № ${requisites.number}; редакция ${revision.revision}; место: ${requisites.place}` },
    { kind: 'REQUISITES', text: `Оперативное время: ${requisites.operationalAt}` },
    { kind: 'REQUISITES', text: `Единицы: ${units.map(([key, unit]) => `${key}=${unit}`).join(', ')}` },
    { kind: 'BODY', text: revision.content.body },
    { kind: 'LEGEND', text: `Легенда: ${legend.length ? legend.join(', ') : 'не используется'}` },
    { kind: 'ATTRIBUTION', text: `Атрибуция: ${attribution.length ? attribution.join('; ') : 'не требуется'}` },
    { kind: 'SOURCE', text: `Источник: ${revision.documentId}; редакция ${revision.revision}; шаблон ${requisites.templateVersion}; SHA-256 ${revision.sha256}` },
  ];
  return {
    schemaVersion: 1,
    source: {
      documentId: revision.documentId,
      revision: revision.revision,
      sha256: revision.sha256,
      templateVersion: requisites.templateVersion,
    },
    exercise: { title: context.exerciseTitle, revision: context.exerciseRevision },
    exportedAt: context.exportedAt,
    document: {
      title: requisites.title,
      number: requisites.number,
      operationalAt: requisites.operationalAt,
      place: requisites.place,
      units: { ...revision.content.units },
    },
    environmentSnapshotId: revision.map?.environmentSnapshotId ?? null,
    legend: [...legend],
    attribution: [...attribution],
    contentBlocks,
    pageNumbering: 'decimal',
  };
}
