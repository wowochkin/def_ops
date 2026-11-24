export type StageDefinition = {
  id: string;
  educationalQuestion: string;
  initialSituation: string;
  expectedActions: readonly string[];
  leadershipRole: string;
  allowedBranches: readonly string[];
  completionConditions: readonly string[];
  documentIds: readonly string[];
  criterionIds: readonly string[];
};
export type ImpactLink = { id: string; stageIds: readonly string[]; affectedBy: readonly string[] };
export type StageImpactLinks = { inputs: readonly ImpactLink[]; maps: readonly ImpactLink[]; documents: readonly ImpactLink[]; criteria: readonly ImpactLink[] };
export type StageImpact = { inputs: string[]; maps: string[]; documents: string[]; criteria: string[] };

export function stageImpact(stageId: string, changedFields: readonly string[], links: StageImpactLinks): StageImpact {
  const select = (items: readonly ImpactLink[]) => items
    .filter(item => item.stageIds.includes(stageId) && item.affectedBy.some(field => changedFields.includes(field)))
    .map(item => item.id)
    .sort();
  return { inputs: select(links.inputs), maps: select(links.maps), documents: select(links.documents), criteria: select(links.criteria) };
}
