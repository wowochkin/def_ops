import { newUUID } from '../model/uuid';

export type ModernRecordKind = 'REPRESENTATIVE' | 'UNIT' | 'HIERARCHY';
export type ModernImportSource = {
  sourceRecordId: string;
  sourceRevision: number;
  sourceHash: string;
  recordKind?: ModernRecordKind;
  modelInputs: false;
  simulationValidated: false;
  characteristics: readonly { field: string; value: unknown }[];
};
export type ModernImportPreviewDetails = Readonly<{
  tree: readonly Readonly<Record<string, unknown>>[];
  equipment: readonly { field: string; value: unknown }[];
  sources: readonly string[];
}>;
export type ModernImportPreview = ModernImportSource & {
  recordKind: ModernRecordKind;
  status: 'IMPORTED' | 'REVIEWED' | 'APPROVED';
  unknown: string[];
  sourceRecord?: Readonly<Record<string, unknown>>;
  preview: ModernImportPreviewDetails;
};
export type ScenarioValue = { field: string; value: unknown; source?: { kind: 'SOURCE' | 'ASSUMPTION'; note: string } };
export type ModernKnowledgeScenarioCopy = ModernImportPreview & {
  id: string;
  sideId: string;
  parentNodeId: string;
  scenarioValues: readonly ScenarioValue[];
};

function clone<T>(value: T): T { return structuredClone(value); }
function characteristicsOf(record: Record<string, unknown> | undefined, fallback: ModernImportSource['characteristics']) {
  const passport = record?.passport;
  if (passport && typeof passport === 'object' && !Array.isArray(passport) && 'characteristics' in passport && Array.isArray(passport.characteristics)) {
    return passport.characteristics.map((fact: { field: string; value: unknown }) => ({ field: fact.field, value: fact.value }));
  }
  return fallback.map(fact => ({ ...fact }));
}
function sourcesOf(record: Record<string, unknown> | undefined): string[] {
  const output = new Set<string>();
  const collect = (value: unknown) => {
    if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') output.add(item);
  };
  collect(record?.sources);
  const passport = record?.passport;
  if (passport && typeof passport === 'object' && 'characteristics' in passport && Array.isArray(passport.characteristics)) {
    for (const fact of passport.characteristics) collect(fact?.source);
  }
  const levels = record?.levels;
  if (Array.isArray(levels)) for (const level of levels) {
    const characteristics = level?.passport?.characteristics;
    if (Array.isArray(characteristics)) for (const fact of characteristics) collect(fact?.source);
  }
  return [...output];
}
function treeOf(kind: ModernRecordKind, record: Record<string, unknown> | undefined): readonly Readonly<Record<string, unknown>>[] {
  if (!record) return [];
  if (kind === 'HIERARCHY') {
    const levels = Array.isArray(record.levels) ? record.levels : [];
    return [{ id: String(record.id), parentId: null, title: record.title ?? record.id },
      ...levels.map(level => ({ id: `${String(record.id)}:${String(level.id)}`, parentId: String(record.id), title: level.title, nativeName: level.nativeName }))];
  }
  if (kind === 'UNIT') return [{
    id: String(record.id), parentId: null, title: record.title ?? record.id,
    hierarchyTemplate: record.hierarchyTemplate, level: record.level, classifications: clone(record.classifications ?? []),
  }];
  const related = Array.isArray(record.relatedOrganizations) ? record.relatedOrganizations : [];
  return related.map((id, index) => ({ id: `${String(record.id)}:equipment-${index + 1}`, parentId: String(id), sourceRecordId: String(record.id) }));
}

export function previewModernImport(source: ModernImportSource, record?: Readonly<Record<string, unknown>>): ModernImportPreview {
  if (!source.sourceRecordId || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 1 || !/^[0-9a-f]{64}$/.test(source.sourceHash)) {
    throw new Error('Источник должен иметь неизменяемую редакцию и SHA-256');
  }
  const recordKind = source.recordKind ?? 'REPRESENTATIVE';
  if (!['REPRESENTATIVE', 'UNIT', 'HIERARCHY'].includes(recordKind)) throw new Error('Неподдерживаемый тип записи источника');
  const equipment = characteristicsOf(record, source.characteristics);
  const sourceRecord = record ? clone(record) : undefined;
  return {
    ...clone(source),
    recordKind,
    sourceRecord,
    characteristics: equipment,
    unknown: equipment.filter(fact => fact.value === null || fact.value === undefined).map(fact => fact.field),
    status: 'IMPORTED',
    preview: { tree: treeOf(recordKind, record), equipment: clone(equipment), sources: sourcesOf(record) },
  };
}

export function commitModernImport(preview: ModernImportPreview, options: { sideId: string; parentNodeId: string; scenarioValues: readonly ScenarioValue[]; idFactory?: () => string }): ModernKnowledgeScenarioCopy {
  if (!options.sideId || !options.parentNodeId) throw new Error('Выберите сторону и родительскую инстанцию');
  for (const value of options.scenarioValues) {
    if (!value.source?.note.trim()) throw new Error('Сценарное значение требует источник или учебное допущение');
  }
  return {
    ...clone(preview),
    id: (options.idFactory ?? newUUID)(),
    sideId: options.sideId,
    parentNodeId: options.parentNodeId,
    scenarioValues: clone(options.scenarioValues),
  };
}

export function assertModernImportReady(preview: ModernImportPreview, requiredFields: readonly string[]) {
  const unknown = requiredFields.filter(field => preview.unknown.includes(field));
  return unknown.length ? { status: 'REQUIRES_REVIEW' as const, unknown } : { status: 'CALCULATED' as const, unknown: [] };
}
