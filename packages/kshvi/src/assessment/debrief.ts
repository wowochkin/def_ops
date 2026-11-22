export const REQUIRED_DEBRIEF_SECTIONS = [
  'GOALS_STAGES', 'INITIAL_SITUATION', 'KEY_DECISIONS', 'PLAN_FACT_MAP', 'TIMELINE', 'DOCUMENTS',
  'COMMUNICATIONS', 'RESOURCES', 'RESEARCH', 'METRICS', 'CONCLUSIONS',
] as const;
export type DebriefSection = typeof REQUIRED_DEBRIEF_SECTIONS[number];
export type DebriefScope = {
  instanceId: string;
  sideId: string;
  trainingQuestions: readonly string[];
  audience: readonly string[];
};
export type DebriefMaterial = DebriefScope & {
  id: string;
  section: DebriefSection;
  payload: Record<string, unknown>;
  draft?: boolean;
};
export type DebriefDeviation = DebriefScope & {
  decisionId: string;
  rationale: string;
  consequences: readonly string[];
};
export type DebriefInput = {
  scope: 'GENERAL' | 'PRIVATE';
  instanceId: string;
  trainingQuestions: readonly string[];
  audience: string;
  allowedSideIds: readonly string[];
  materials: readonly DebriefMaterial[];
  referenceIntent: Record<string, unknown>;
  deviations: readonly DebriefDeviation[];
};
export type DebriefPackage = Omit<DebriefInput, 'materials' | 'referenceIntent'> & {
  materials: DebriefMaterial[];
  reference: { kind: 'LEADERSHIP_INTENT'; notTheOnlyCorrectSolution: true; content: Record<string, unknown> };
  deviations: readonly DebriefDeviation[];
  draftComments?: readonly string[];
};
export type DebriefPublicationInput = {
  revision: number;
  audience: readonly string[];
  publishedBy: string;
  publishedAt: string;
};
export type PublishedDebrief = Omit<DebriefPackage, 'draftComments' | 'audience'> & DebriefPublicationInput & {
  schemaVersion: 1;
  audience: readonly string[];
};

function permitted<T extends DebriefScope>(item: T, input: Pick<DebriefInput, 'scope' | 'instanceId' | 'trainingQuestions' | 'allowedSideIds'>, audiences: readonly string[]): boolean {
  return input.allowedSideIds.includes(item.sideId)
    && item.audience.some(audience => audiences.includes(audience))
    && item.trainingQuestions.some(question => input.trainingQuestions.includes(question))
    && (input.scope === 'GENERAL' || item.instanceId === input.instanceId);
}
function withUnknownSections(materials: readonly DebriefMaterial[], input: DebriefInput | DebriefPackage, audiences: readonly string[]): DebriefMaterial[] {
  return REQUIRED_DEBRIEF_SECTIONS.flatMap(section => {
    const existing = materials.filter(material => material.section === section);
    return existing.length ? structuredClone(existing) : [{
      id: `unknown-${section}`, section, instanceId: input.instanceId, sideId: input.allowedSideIds[0] ?? 'UNKNOWN',
      trainingQuestions: [...input.trainingQuestions], audience: [...audiences],
      payload: { status: 'UNKNOWN', reason: `Нет разрешённых данных раздела ${section}` },
    }];
  });
}

export function buildDebrief(input: DebriefInput): DebriefPackage {
  const materials = withUnknownSections(input.materials.filter(material => !material.draft && permitted(material, input, [input.audience])), input, [input.audience]);
  return {
    scope: input.scope, instanceId: input.instanceId, trainingQuestions: [...input.trainingQuestions], audience: input.audience,
    allowedSideIds: [...input.allowedSideIds], materials,
    reference: { kind: 'LEADERSHIP_INTENT', notTheOnlyCorrectSolution: true, content: structuredClone(input.referenceIntent) },
    deviations: input.deviations.filter(deviation => permitted(deviation, input, [input.audience])).map(deviation => structuredClone(deviation)),
  };
}

export function publishDebrief(debrief: DebriefPackage, input: DebriefPublicationInput): PublishedDebrief {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('Публикации разбора нужна неизменяемая редакция');
  if (!input.audience.length || !input.publishedBy.trim() || !input.publishedAt) throw new Error('Публикации нужны аудитория, ответственный и время');
  const { draftComments: ignoredDraftComments, ...material } = structuredClone(debrief);
  void ignoredDraftComments;
  const materials = withUnknownSections(material.materials.filter(item => !item.draft && permitted(item, material, input.audience)), material, input.audience);
  const deviations = material.deviations.filter(deviation => permitted(deviation, material, input.audience));
  return {
    ...material,
    materials,
    deviations,
    schemaVersion: 1,
    revision: input.revision,
    audience: [...input.audience],
    publishedBy: input.publishedBy,
    publishedAt: input.publishedAt,
  };
}
