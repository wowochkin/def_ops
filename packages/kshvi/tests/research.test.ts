import { expect, it } from 'vitest';
import { concludeResearch, createResearchCard } from '../src/replay/research-card';

const input = {
  question: 'Как резервный канал связан с задержкой?', hypothesis: 'Резервный канал уменьшает задержку',
  variables: ['канал', 'задержка'], method: 'Сопоставление сохранённых эпизодов', design: 'OBSERVATIONAL' as const,
  owners: ['methodist-1'], requiredData: ['message.delivery'], observationPlan: ['Сопоставить correlationId'],
  startsAt: '2026-11-21T00:00:00.000Z', endsAt: '2026-11-22T00:00:00.000Z', evidenceIds: ['event-1'], calculationIds: ['calc-1'],
};

it('содержит полный план исследования и не выводит причинность из наблюдения', () => {
  const card = createResearchCard(input);
  expect(card.evidenceIds).toEqual(['event-1']);
  expect(() => concludeResearch(card, {
    results: ['Задержка ниже'], limitations: ['Малая выборка'], conclusion: 'Канал является причиной', causalClaim: 'CAUSAL',
  })).toThrow('причинность');
  const result = concludeResearch(card, {
    results: ['Задержка ниже'], limitations: ['Малая выборка'], conclusion: 'Обнаружена связь, причинность не доказана', causalClaim: 'ASSOCIATION',
  });
  expect(result.causalStatus).toBe('NOT_ESTABLISHED');
  expect(result.limitations).toEqual(['Малая выборка']);
});

it('требует исследовательский дизайн даже для заявления о причинности', () => {
  const card = createResearchCard({ ...input, design: 'CONTROLLED_EXPERIMENT', evidenceIds: ['event-1', 'event-2'] });
  const result = concludeResearch(card, {
    results: ['Контроль и воздействие различимы'], limitations: ['Один сценарий'], conclusion: 'Причинный эффект подтверждён дизайном', causalClaim: 'CAUSAL',
  });
  expect(result.causalStatus).toBe('SUPPORTED_BY_DESIGN');
});
