import { hashCanonical } from './initial-map-hash';
import type { JsonValue } from '../model/types';

export const REQUIRED_SCENARIO_ITEMS = [
  'ORGANIZATION_ORDER', 'PREPARATION_CALENDAR', 'LEADERSHIP_SCHEME', 'CONCEPT', 'OPERATIONAL_ASSIGNMENTS',
  'CONDUCT_CALENDAR', 'ESCALATION_PLAN', 'MAP_SET', 'AGENT_PROFILES', 'PRIVATE_PLANS',
  'ELECTRONIC_INTERMEDIARIES', 'COMMUNICATION_PLAN', 'EQUIPMENT_STATEMENT', 'LOGISTICS_PLAN',
  'FORMATION_PLAN', 'READINESS_PLAN', 'ASSESSMENT_PLAN', 'RESEARCH_PLAN', 'ASSUMPTION_PASSPORT',
] as const;
export type ScenarioItem = typeof REQUIRED_SCENARIO_ITEMS[number];
export type ScenarioItemLink = Readonly<{
  item: ScenarioItem;
  present: boolean;
  documentId?: string;
  revision?: number;
  sha256?: string;
}>;
export type ScenarioKitDocument = Readonly<{
  id: string;
  item: ScenarioItem;
  revision: number;
  content: JsonValue;
  dependsOn: readonly string[];
  sha256: string;
}>;
export type ScenarioKit = {
  items: readonly ScenarioItemLink[];
  documents?: readonly ScenarioKitDocument[];
  usesLogistics: boolean;
  usesAutonomy?: boolean;
  researchGoals?: boolean;
  omissions: readonly { item: ScenarioItem; reason: string; decisionBy: string }[];
};
export type LinkedScenarioKit = ScenarioKit & { documents: readonly ScenarioKitDocument[] };
export type KitIssue = { code: string; severity: 'ERROR' | 'WARNING'; item: ScenarioItem; message: string };

const SHA256 = /^[0-9a-f]{64}$/;
function documentHash(document: Omit<ScenarioKitDocument, 'sha256'>): string {
  return hashCanonical(document);
}
function issue(code: string, item: ScenarioItem, message: string): KitIssue {
  return { code, severity: 'ERROR', item, message };
}
function validateDocumentLinks(kit: ScenarioKit, item: ScenarioItem, link: ScenarioItemLink): KitIssue[] {
  if (!link.documentId || !Number.isSafeInteger(link.revision) || (link.revision ?? 0) < 1 || !link.sha256 || !SHA256.test(link.sha256)) {
    return [issue('DOCUMENT_LINK_REQUIRED', item, 'Часть должна ссылаться на версионный документ с SHA-256')];
  }
  const document = kit.documents?.find(candidate => candidate.id === link.documentId);
  if (!document) return [issue('DOCUMENT_LINK_REQUIRED', item, 'Связанный документ отсутствует в серверной редакции')];
  if (document.item !== item || document.revision !== link.revision || document.sha256 !== link.sha256) {
    return [issue('DOCUMENT_LINK_MISMATCH', item, 'Ссылка части не совпадает с редакцией документа')];
  }
  const { sha256, ...content } = document;
  if (!SHA256.test(sha256) || documentHash(content) !== sha256) return [issue('DOCUMENT_HASH_INVALID', item, 'SHA-256 документа не совпадает с содержимым')];
  const ids = new Set((kit.documents ?? []).map(candidate => candidate.id));
  if (document.dependsOn.some(id => id === document.id || !ids.has(id))) return [issue('DOCUMENT_DEPENDENCY_MISSING', item, 'Документ ссылается на отсутствующую зависимость')];
  return [];
}

export function validateKit(kit: ScenarioKit): KitIssue[] {
  const issues: KitIssue[] = [];
  const documentIds = new Set<string>();
  for (const document of kit.documents ?? []) {
    if (documentIds.has(document.id)) issues.push(issue('DOCUMENT_DUPLICATE', document.item, `Документ ${document.id} повторяется`));
    documentIds.add(document.id);
  }
  for (const item of REQUIRED_SCENARIO_ITEMS) {
    const present = kit.items.filter(candidate => candidate.item === item && candidate.present);
    const omission = kit.omissions.find(candidate => candidate.item === item);
    if (present.length) {
      if (present.length > 1) issues.push(issue('DOCUMENT_DUPLICATE', item, 'Для части указано несколько действующих документов'));
      for (const link of present) issues.push(...validateDocumentLinks(kit, item, link));
      continue;
    }
    if (item === 'MAP_SET') {
      issues.push({ code: 'INITIAL_MAP_REQUIRED', severity: 'ERROR', item, message: 'Начальная карта обязательна' });
      continue;
    }
    if (item === 'LOGISTICS_PLAN' && kit.usesLogistics) {
      issues.push({ code: 'LOGISTICS_PLAN_REQUIRED', severity: 'ERROR', item, message: 'План МТО обязателен при использовании логистики' });
      continue;
    }
    if (item === 'AGENT_PROFILES' && kit.usesAutonomy) {
      issues.push({ code: 'AGENT_PROFILES_REQUIRED', severity: 'ERROR', item, message: 'Профиль автономных участников обязателен' });
      continue;
    }
    if (item === 'RESEARCH_PLAN') {
      if (kit.researchGoals) issues.push({ code: 'RESEARCH_PLAN_REQUIRED', severity: 'ERROR', item, message: 'При исследовательских целях нужен план исследований' });
      else if (omission?.reason && omission.decisionBy) issues.push({ code: 'OMISSION_ACCEPTED', severity: 'WARNING', item, message: omission.reason });
      continue;
    }
    if (!omission?.reason || !omission.decisionBy) {
      issues.push({ code: 'MISSING_REQUIRED_ITEM', severity: 'ERROR', item, message: 'Часть отсутствует без обоснованного решения руководителя' });
    } else {
      issues.push({ code: 'OMISSION_ACCEPTED', severity: 'WARNING', item, message: omission.reason });
    }
  }
  return issues;
}

export function buildLinkedScenarioKit(input: {
  documents: readonly (Omit<ScenarioKitDocument, 'sha256' | 'dependsOn'> & { dependsOn?: readonly string[] })[];
  usesLogistics: boolean;
  usesAutonomy?: boolean;
  researchGoals?: boolean;
  omissions?: ScenarioKit['omissions'];
}): LinkedScenarioKit {
  const documents = input.documents.map(document => {
    const complete = { ...document, dependsOn: [...(document.dependsOn ?? [])] };
    return { ...complete, sha256: documentHash(complete) };
  });
  const kit: LinkedScenarioKit = {
    items: REQUIRED_SCENARIO_ITEMS.flatMap(item => {
      const document = documents.find(candidate => candidate.item === item);
      return document ? [{ item, present: true as const, documentId: document.id, revision: document.revision, sha256: document.sha256 }] : [];
    }),
    documents,
    usesLogistics: input.usesLogistics,
    ...(input.usesAutonomy === undefined ? {} : { usesAutonomy: input.usesAutonomy }),
    ...(input.researchGoals === undefined ? {} : { researchGoals: input.researchGoals }),
    omissions: [...(input.omissions ?? [])],
  };
  const errors = validateKit(kit).filter(issue => issue.severity === 'ERROR');
  if (errors.length) throw new Error(`Сценарный комплект неполон: ${errors.map(issue => issue.code).join(', ')}`);
  return kit;
}
