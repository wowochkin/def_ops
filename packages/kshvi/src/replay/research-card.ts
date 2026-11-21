import { createHash } from 'node:crypto';
import { canonicalJson } from '../events/canonical';

export type ResearchDesign = 'OBSERVATIONAL' | 'CONTROLLED_EXPERIMENT' | 'QUASI_EXPERIMENT';
export type ResearchCardInput = {
  id?: string;
  question: string;
  hypothesis: string;
  variables: readonly string[];
  method: string;
  design: ResearchDesign;
  owners: readonly string[];
  requiredData: readonly string[];
  observationPlan: readonly string[];
  startsAt: string;
  endsAt: string;
  evidenceIds: readonly string[];
  calculationIds: readonly string[];
};
export type ResearchCard = ResearchCardInput & {
  id: string;
  status: 'OPEN' | 'COMPLETED';
  results: readonly string[];
  limitations: readonly string[];
  conclusion: string | null;
  causalStatus: 'NOT_ESTABLISHED' | 'SUPPORTED_BY_DESIGN';
};
export type ResearchConclusionInput = {
  results: readonly string[];
  limitations: readonly string[];
  conclusion: string;
  causalClaim: 'CAUSAL' | 'ASSOCIATION' | 'NONE';
};

export function createResearchCard(input: ResearchCardInput): ResearchCard {
  const requiredStrings = [input.question, input.hypothesis, input.method, input.startsAt, input.endsAt];
  if (requiredStrings.some(value => !value.trim())) throw new Error('Исследовательская карточка содержит обязательные пустые поля');
  if (!input.variables.length || !input.owners.length || !input.requiredData.length || !input.observationPlan.length) {
    throw new Error('Исследованию нужны переменные, ответственные, данные и план наблюдений');
  }
  const id = input.id ?? `research-${createHash('sha256').update(canonicalJson(input)).digest('hex').slice(0, 16)}`;
  return {
    ...structuredClone(input), id, status: 'OPEN', results: [], limitations: [], conclusion: null, causalStatus: 'NOT_ESTABLISHED',
  };
}

export function concludeResearch(card: ResearchCard, input: ResearchConclusionInput): ResearchCard {
  if (!input.conclusion.trim() || !input.limitations.length) throw new Error('Вывод исследования требует явных ограничений');
  if (input.causalClaim === 'CAUSAL') {
    if (card.design === 'OBSERVATIONAL') throw new Error('Наблюдение не доказывает причинность');
    if (card.evidenceIds.length < 2) throw new Error('Для причинного вывода недостаточно доказательств и контроля');
  }
  return {
    ...structuredClone(card), status: 'COMPLETED', results: [...input.results], limitations: [...input.limitations],
    conclusion: input.conclusion,
    causalStatus: input.causalClaim === 'CAUSAL' ? 'SUPPORTED_BY_DESIGN' : 'NOT_ESTABLISHED',
  };
}
