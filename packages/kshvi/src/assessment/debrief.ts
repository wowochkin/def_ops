export const REQUIRED_DEBRIEF_SECTIONS = [
  'GOALS_STAGES', 'INITIAL_SITUATION', 'KEY_DECISIONS', 'PLAN_FACT_MAP', 'TIMELINE', 'DOCUMENTS',
  'COMMUNICATIONS', 'RESOURCES', 'RESEARCH', 'METRICS', 'CONCLUSIONS',
] as const;
export type DebriefSection = typeof REQUIRED_DEBRIEF_SECTIONS[number];
export type DebriefMaterial = {
  id: string;
  section: DebriefSection;
  instanceId: string;
  sideId: string;
  trainingQuestions: readonly string[];
  audience: readonly string[];
  payload: Record<string, unknown>;
  draft?: boolean;
};
export type DebriefInput = {
  scope: 'GENERAL' | 'PRIVATE';
  instanceId: string;
  trainingQuestions: readonly string[];
  audience: string;
  allowedSideIds: readonly string[];
  materials: readonly DebriefMaterial[];
  referenceIntent: Record<string, unknown>;
  deviations: readonly { decisionId: string; rationale: string; consequences: readonly string[] }[];
};
export type DebriefPackage = Omit<DebriefInput, 'materials' | 'referenceIntent'> & {
  materials: DebriefMaterial[];
  reference: { kind: 'LEADERSHIP_INTENT'; notTheOnlyCorrectSolution: true; content: Record<string, unknown> };
  deviations: DebriefInput['deviations'];
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

export function buildDebrief(input: DebriefInput): DebriefPackage {
  const permitted = input.materials.filter(material => !material.draft
    && input.allowedSideIds.includes(material.sideId)
    && material.audience.includes(input.audience)
    && material.trainingQuestions.some(question => input.trainingQuestions.includes(question))
    && (input.scope === 'GENERAL' || material.instanceId === input.instanceId));
  const materials = REQUIRED_DEBRIEF_SECTIONS.flatMap(section => {
    const existing = permitted.filter(material => material.section === section);
    return existing.length ? structuredClone(existing) : [{
      id: `unknown-${section}`, section, instanceId: input.instanceId, sideId: input.allowedSideIds[0] ?? 'UNKNOWN',
      trainingQuestions: [...input.trainingQuestions], audience: [input.audience],
      payload: { status: 'UNKNOWN', reason: `Нет разрешённых данных раздела ${section}` },
    }];
  });
  return {
    scope: input.scope, instanceId: input.instanceId, trainingQuestions: [...input.trainingQuestions], audience: input.audience,
    allowedSideIds: [...input.allowedSideIds], materials,
    reference: { kind: 'LEADERSHIP_INTENT', notTheOnlyCorrectSolution: true, content: structuredClone(input.referenceIntent) },
    deviations: structuredClone(input.deviations),
  };
}

export function publishDebrief(debrief: DebriefPackage, input: DebriefPublicationInput): PublishedDebrief {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('Публикации разбора нужна неизменяемая редакция');
  if (!input.audience.length || !input.publishedBy.trim() || !input.publishedAt) throw new Error('Публикации нужны аудитория, ответственный и время');
  const { draftComments: ignoredDraftComments, ...material } = structuredClone(debrief);
  void ignoredDraftComments;
  return {
    ...material,
    materials: material.materials.filter(item => !item.draft),
    schemaVersion: 1,
    revision: input.revision,
    audience: [...input.audience],
    publishedBy: input.publishedBy,
    publishedAt: input.publishedAt,
  };
}
