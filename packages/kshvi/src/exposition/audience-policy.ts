export const AUDIENCE_LAYERS = ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'] as const;
export type AudienceLayer = typeof AUDIENCE_LAYERS[number];

export type AudiencePolicy = Readonly<{
  id: string;
  allowedLayers: readonly AudienceLayer[];
  showPlanFact: boolean;
  showExplanations: boolean;
  publicCaptionIds: readonly string[];
  publicExplanationIds: readonly string[];
  publicDecisionIds: readonly string[];
}>;
export type AudiencePolicyInput = Omit<AudiencePolicy, 'publicExplanationIds'> & Readonly<{
  publicExplanationIds?: readonly string[];
}>;

export function createAudiencePolicy(input: AudiencePolicyInput): AudiencePolicy {
  if (!input.id.trim()) throw new Error('Для политики аудитории нужен идентификатор');
  const allowedLayers = [...new Set(input.allowedLayers)];
  if (allowedLayers.some(layer => !AUDIENCE_LAYERS.includes(layer))) throw new Error('Неизвестный слой аудиторной проекции');
  return {
    id: input.id,
    allowedLayers,
    showPlanFact: input.showPlanFact,
    showExplanations: input.showExplanations,
    publicCaptionIds: [...new Set(input.publicCaptionIds)],
    publicExplanationIds: [...new Set(input.publicExplanationIds ?? [])],
    publicDecisionIds: [...new Set(input.publicDecisionIds)],
  };
}

export function audienceLayers(policy: AudiencePolicy, projectorLayers: readonly AudienceLayer[]): readonly AudienceLayer[] {
  const projector = new Set(projectorLayers);
  return policy.allowedLayers.filter(layer => projector.has(layer));
}
