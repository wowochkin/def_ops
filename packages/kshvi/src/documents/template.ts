import type { DocumentRequisites, DocumentType, VisibilityScope } from './document';

export type TemplateValidationRule = Readonly<{
  field: string;
  required: boolean;
  message: string;
}>;

export type DocumentTemplate = Readonly<{
  id: string;
  type: DocumentType;
  version: string;
  dataSchema: Readonly<Record<string, 'string' | 'array' | 'object'>>;
  validationRules: readonly TemplateValidationRule[];
  approvalRouteId: string;
  visibility: VisibilityScope;
  textLayout: string;
  mapLayout: Readonly<{ enabled: boolean; legend: boolean; attribution: boolean }>;
  autoFillRequisites: readonly (keyof DocumentRequisites)[];
}>;

const definitions: readonly Readonly<{ type: DocumentType; id: string }>[] = [
  { type: 'ORDER', id: 'order' },
  { type: 'COMBAT_ORDER', id: 'combat-order' },
  { type: 'DIRECTIVE', id: 'directive' },
  { type: 'PLAN', id: 'plan' },
  { type: 'REPORT', id: 'report' },
  { type: 'BRIEFING', id: 'briefing' },
  { type: 'REQUEST', id: 'request' },
  { type: 'INTELLIGENCE_SUMMARY', id: 'intelligence-summary' },
  { type: 'OPERATIONAL_ASSIGNMENT', id: 'operational-assignment' },
  { type: 'INJECT', id: 'inject' },
  { type: 'DUTY_JOURNAL', id: 'duty-journal' },
  { type: 'ASSESSMENT_SHEET', id: 'assessment-sheet' },
  { type: 'DEBRIEF_MATERIAL', id: 'debrief-material' },
];

const autoFillRequisites = [
  'title', 'number', 'operationalAt', 'deadlineAt', 'addressees', 'linkedTaskIds',
] as const satisfies readonly (keyof DocumentRequisites)[];

export const documentTemplateLibrary: readonly DocumentTemplate[] = definitions.map(({ type, id }) => ({
  id,
  type,
  version: `${id}:v1`,
  dataSchema: { requisites: 'object', body: 'string', addressees: 'array', linkedTaskIds: 'array' },
  validationRules: [
    { field: 'requisites.basis', required: true, message: 'Нужно основание документа' },
    { field: 'requisites.addressees', required: true, message: 'Нужен адресат из дерева инстанций' },
    { field: 'content.body', required: true, message: 'Нужно содержимое документа' },
  ],
  approvalRouteId: `${id}-approval:v1`,
  visibility: { sideIds: [], instanceIds: [], roles: [] },
  textLayout: '{{body}}',
  mapLayout: { enabled: true, legend: true, attribution: true },
  autoFillRequisites,
}));

export function templateForType(type: DocumentType): DocumentTemplate {
  const template = documentTemplateLibrary.find(candidate => candidate.type === type);
  if (!template) throw new Error(`Шаблон ${type} не зарегистрирован`);
  return template;
}
