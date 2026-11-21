import { newUUID } from '../model/uuid';

export type ModernImportSource = {
  sourceRecordId: string;
  sourceRevision: number;
  sourceHash: string;
  modelInputs: false;
  simulationValidated: false;
  characteristics: readonly { field: string; value: unknown }[];
};
export type ModernImportPreview = ModernImportSource & {
  status: 'IMPORTED' | 'REVIEWED' | 'APPROVED';
  unknown: string[];
};
export type ScenarioValue = { field: string; value: unknown; source?: { kind: 'SOURCE' | 'ASSUMPTION'; note: string } };
export type ModernKnowledgeScenarioCopy = ModernImportPreview & {
  id: string;
  sideId: string;
  parentNodeId: string;
  scenarioValues: readonly ScenarioValue[];
};

export function previewModernImport(source: ModernImportSource): ModernImportPreview {
  if (!source.sourceRecordId || !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 1 || !/^[0-9a-f]{64}$/.test(source.sourceHash)) throw new Error('Источник должен иметь неизменяемую редакцию и SHA-256');
  return { ...source, characteristics: source.characteristics.map(fact => ({ ...fact })), unknown: source.characteristics.filter(fact => fact.value === null || fact.value === undefined).map(fact => fact.field), status: 'IMPORTED' };
}

export function commitModernImport(preview: ModernImportPreview, options: { sideId: string; parentNodeId: string; scenarioValues: readonly ScenarioValue[]; idFactory?: () => string }): ModernKnowledgeScenarioCopy {
  if (!options.sideId || !options.parentNodeId) throw new Error('Выберите сторону и родительскую инстанцию');
  for (const value of options.scenarioValues) {
    if (!value.source?.note.trim()) throw new Error('Сценарное значение требует источник или учебное допущение');
  }
  return { ...preview, id: (options.idFactory ?? newUUID)(), sideId: options.sideId, parentNodeId: options.parentNodeId, scenarioValues: options.scenarioValues.map(value => ({ ...value })) };
}

export function assertModernImportReady(preview: ModernImportPreview, requiredFields: readonly string[]) {
  const unknown = requiredFields.filter(field => preview.unknown.includes(field));
  return unknown.length ? { status: 'REQUIRES_REVIEW' as const, unknown } : { status: 'CALCULATED' as const, unknown: [] };
}
